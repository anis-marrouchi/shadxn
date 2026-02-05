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
    provider: providerName = "claude",
    model,
    apiKey,
    context7 = true,
    interactive = true,
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

  // 5. Create provider and generate
  const provider = createProvider(providerName, apiKey)

  const messages: GenerationMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ]

  logger.info("Generating...")
  let result = await provider.generate(messages, { model, maxTokens: 8192 })

  // 6. Handle follow-up questions (interactive mode)
  if (result.followUp && interactive) {
    return {
      files: { written: [], skipped: [], errors: [] },
      content: result.content,
      outputType,
      followUp: result.followUp,
      tokensUsed: result.tokensUsed,
    }
  }

  // 7. Write files
  const outputDir = resolveOutputDir(outputType, context.techStack, options.outputDir)

  const writeResult = await writeGeneratedFiles(result.files, {
    cwd,
    overwrite,
    dryRun,
    outputDir,
  })

  return {
    files: writeResult,
    content: result.content,
    outputType,
    tokensUsed: result.tokensUsed,
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
- Do NOT add unnecessary dependencies`)

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
