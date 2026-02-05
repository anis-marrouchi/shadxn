import type { AgentProvider, GenerationMessage, GenerationResult, OutputType } from "./providers/types"
import { agentConfigSchema, type AgentConfig } from "./providers/types"
import { createProvider, type ProviderName } from "./providers"
import { detectTechStack, formatTechStack, type TechStack } from "./context/tech-stack"
import { detectSchemas, formatSchemas, type ProjectSchemas } from "./context/schema"
import { gatherContext7Docs } from "./context/context7"
import { loadLocalSkills, matchSkillsToTask } from "./skills/loader"
import { resolveOutputType } from "./outputs/types"
import { writeGeneratedFiles, resolveOutputDir, type WriteOptions, type WriteResult } from "./outputs/handlers"
import { logger } from "@/src/utils/logger"
import type { Skill } from "./skills/types"

// --- Agent Orchestrator: the brain that coordinates everything ---

export interface AgentContext {
  techStack: TechStack
  schemas: ProjectSchemas
  skills: Skill[]
  docs: string
  config: AgentConfig
}

export interface GenerateOptions {
  task: string
  outputType?: OutputType
  outputDir?: string
  overwrite?: boolean
  dryRun?: boolean
  provider?: ProviderName
  model?: string
  apiKey?: string
  cwd: string
  context7?: boolean
  interactive?: boolean
  skills?: string[] // Additional skill packages to load
  maxSteps?: number // Max agentic loop iterations (default 5)
}

export interface GenerateResult {
  files: WriteResult
  content: string
  outputType: OutputType
  followUp?: string
  tokensUsed?: number
}

export async function createAgentContext(
  cwd: string,
  task: string,
  config?: Partial<AgentConfig>
): Promise<AgentContext> {
  const agentConfig = agentConfigSchema.parse(config || {})

  // Gather all context in parallel
  const [techStack, schemas, skills] = await Promise.all([
    detectTechStack(cwd),
    detectSchemas(cwd),
    loadLocalSkills(cwd),
  ])

  // Context7 docs (optional, can fail gracefully)
  let docs = ""
  if (agentConfig.context7.enabled) {
    try {
      docs = await gatherContext7Docs(techStack, task, agentConfig.context7.apiKey)
    } catch {
      // Context7 is optional, don't fail the whole flow
    }
  }

  return {
    techStack,
    schemas,
    skills,
    docs,
    config: agentConfig,
  }
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const {
    task,
    cwd,
    overwrite = false,
    dryRun = false,
    provider: providerName = "claude-code",
    model,
    apiKey,
    context7 = true,
    interactive = true,
    maxSteps = 5,
  } = options

  // 1. Gather context
  logger.info("Analyzing project...")
  const context = await createAgentContext(cwd, task, {
    provider: providerName,
    context7: { enabled: context7, apiKey },
  })

  // 2. Resolve output type
  const outputType = resolveOutputType(options.outputType, task)
  logger.info(`Output type: ${outputType}`)

  // 3. Match relevant skills
  const matchedSkills = matchSkillsToTask(context.skills, task, outputType)
  if (matchedSkills.length) {
    logger.info(
      `Loaded ${matchedSkills.length} relevant skill(s): ${matchedSkills.map((m) => m.skill.frontmatter.name).join(", ")}`
    )
  }

  // 4. Build system prompt
  const systemPrompt = buildSystemPrompt(context, outputType, matchedSkills.map((m) => m.skill))

  // 5. Create provider and run multi-step agent loop
  const provider = createProvider(providerName, apiKey)

  const messages: GenerationMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ]

  logger.info("Generating...")

  const allFiles: import("./providers/types").GeneratedFile[] = []
  let totalTokens = 0
  let content = ""
  let followUp: string | undefined
  let step = 0

  // --- Multi-step agent loop ---
  // The agent can chain multiple generation steps. Each step's output
  // becomes context for the next, enabling complex multi-file generation
  // where later files depend on earlier ones (e.g., schema → API → UI → tests).
  while (step < maxSteps) {
    step++
    if (step > 1) {
      logger.info(`Step ${step}/${maxSteps}...`)
    }

    const result = await provider.generate(messages, {
      model,
      maxTokens: 8192,
    })

    totalTokens += result.tokensUsed || 0
    content = result.content

    // Collect generated files
    if (result.files.length) {
      allFiles.push(...result.files)
    }

    // If the agent asks a follow-up, break and surface to user
    if (result.followUp) {
      followUp = result.followUp
      break
    }

    // Check if the agent signaled completion (no tool use, or stop_reason is end_turn)
    // If files were generated and there's no indication of more work, we're done
    if (result.files.length === 0 && step > 1) {
      // No more files to generate — agent is done
      break
    }

    // For complex tasks, check if the agent wants to continue by looking for
    // continuation signals in the response content
    const wantsContinuation =
      result.content.includes("[CONTINUE]") ||
      result.content.includes("Next, I'll") ||
      result.content.includes("Now let me") ||
      result.content.includes("I'll also generate")

    if (!wantsContinuation) {
      break
    }

    // Feed back what was generated so the agent can build on it
    const filesSummary = result.files
      .map((f) => `Created: ${f.path}${f.description ? ` — ${f.description}` : ""}`)
      .join("\n")

    messages.push({
      role: "assistant",
      content: result.content + (filesSummary ? `\n\nFiles created:\n${filesSummary}` : ""),
    })

    messages.push({
      role: "user",
      content:
        "Continue generating the remaining files. Build on what you've already created. When finished, do not include [CONTINUE] in your response.",
    })
  }

  if (step > 1) {
    logger.info(`Completed in ${step} step(s)`)
  }

  // 6. Handle follow-up questions (interactive mode)
  if (followUp && interactive) {
    return {
      files: { written: [], skipped: [], errors: [] },
      content,
      outputType,
      followUp,
      tokensUsed: totalTokens,
    }
  }

  // 7. Deduplicate files (later versions override earlier ones)
  const deduped = new Map<string, import("./providers/types").GeneratedFile>()
  for (const file of allFiles) {
    deduped.set(file.path, file)
  }

  // 8. Write files
  const outputDir = resolveOutputDir(outputType, context.techStack, options.outputDir)

  const writeResult = await writeGeneratedFiles(Array.from(deduped.values()), {
    cwd,
    overwrite,
    dryRun,
    outputDir,
  })

  return {
    files: writeResult,
    content,
    outputType,
    tokensUsed: totalTokens,
  }
}

function buildSystemPrompt(
  context: AgentContext,
  outputType: string,
  skills: Skill[]
): string {
  const sections: string[] = []

  // Identity
  sections.push(`You are shadxn, an agentic code generation tool. You generate high-quality, production-ready output for any tech stack.

Your primary tool is \`create_files\` — use it to output all generated code, documents, and configs as files.
If the request is ambiguous or you need critical information to proceed correctly, use \`ask_user\` to ask a clarifying question.

IMPORTANT RULES:
- Generate complete, working code — not stubs or placeholders
- Follow the project's existing patterns and conventions
- Use the detected tech stack to choose the right language, framework, and patterns
- File paths should be relative to the project root
- Include all necessary imports
- Do NOT add unnecessary dependencies

MULTI-STEP GENERATION:
For complex tasks that require multiple related files (e.g., schema + API + UI + tests), you can chain steps:
- Generate the foundational files first (schemas, types, configs)
- Include "[CONTINUE]" in your response text when there are more files to generate
- In subsequent steps, you'll see what was already created — build on it
- When all files are generated, do NOT include "[CONTINUE]"
- This enables you to generate a schema first, then an API that references it, then a UI that calls the API`)

  // Tech stack context
  sections.push(`# Project Tech Stack\n${formatTechStack(context.techStack)}`)

  // Key dependencies
  const deps = Object.keys(context.techStack.dependencies).slice(0, 30)
  if (deps.length) {
    sections.push(`# Key Dependencies\n${deps.join(", ")}`)
  }

  // Schema context
  const schemaStr = formatSchemas(context.schemas)
  if (schemaStr) {
    sections.push(`# Project Schemas\n${schemaStr}`)
  }

  // Skills context
  if (skills.length) {
    sections.push(
      `# Active Skills\nFollow these skill instructions when applicable:\n\n` +
        skills
          .map(
            (s) =>
              `## Skill: ${s.frontmatter.name}\n${s.frontmatter.description}\n\n${s.instructions}`
          )
          .join("\n\n---\n\n")
    )
  }

  // Context7 docs
  if (context.docs) {
    sections.push(context.docs)
  }

  // Output type guidance
  sections.push(`# Output Type: ${outputType}\nGenerate output appropriate for: ${outputType}. Use the \`create_files\` tool to output all files.`)

  return sections.join("\n\n")
}

// Re-export key types
export type { TechStack } from "./context/tech-stack"
export type { ProjectSchemas } from "./context/schema"
export type { Skill } from "./skills/types"
export type { AgentConfig, OutputType, GeneratedFile } from "./providers/types"
