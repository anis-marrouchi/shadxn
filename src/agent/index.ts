import type { AgentProvider, GenerationMessage, GenerationResult, OutputType, StreamEvent } from "./providers/types"
import { agentConfigSchema, type AgentConfig } from "./providers/types"
import { createProvider, type ProviderName } from "./providers"
import { loadAuthConfig } from "@/src/utils/auth-store"
import { ensureCredentials } from "@/src/commands/model"
import { detectTechStack, formatTechStack, type TechStack } from "./context/tech-stack"
import { detectSchemas, formatSchemas, type ProjectSchemas } from "./context/schema"
import { gatherContext7Docs } from "./context/context7"
import { loadLocalSkills, matchSkillsToTask } from "./skills/loader"
import { resolveOutputType } from "./outputs/types"
import { writeGeneratedFiles, resolveOutputDir, type WriteOptions, type WriteResult } from "./outputs/handlers"
import { logger } from "@/src/utils/logger"
import { globalHooks } from "@/src/hooks"
import { globalTracker } from "@/src/observability"
import { debug } from "@/src/observability"
import { MemoryHierarchy, ContextBuilder, loadProjectInstructions } from "@/src/memory"
import type { Skill } from "./skills/types"
import { runAgenticLoop, supportsAgenticLoop, type AgenticProgressEvent } from "./orchestrator"
import { AsyncQueue } from "@/src/utils/async-queue"

// --- Agent Orchestrator: the brain that coordinates everything ---

export interface AgentContext {
  techStack: TechStack
  schemas: ProjectSchemas
  skills: Skill[]
  docs: string
  config: AgentConfig
  memoryContext: string
  projectInstructions: string
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
  maxSteps?: number // Max agentic loop iterations (default 20 for agentic, 5 for legacy)
  sessionMessages?: GenerationMessage[] // Multi-turn context from REPL sessions
  heal?: boolean // undefined = auto (heal if files written), false = skip
  healConfig?: {
    testCommand?: string
    buildCommand?: string
    lintCommand?: string
    maxAttempts?: number
  }
}

export interface GenerateResult {
  files: WriteResult
  content: string
  outputType: OutputType
  followUp?: string
  tokensUsed?: number
  healResult?: import("@/src/runtime/heal").HealResult
}

export async function createAgentContext(
  cwd: string,
  task: string,
  config?: Partial<AgentConfig>
): Promise<AgentContext> {
  const agentConfig = agentConfigSchema.parse(config || {})

  // Load memory hierarchy
  const memory = new MemoryHierarchy(cwd)
  await memory.load()

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

  // Build memory context from both user and project levels
  const memoryContext = memory.buildMemoryContext(task)

  // Load project instructions (SHADXN.md or CLAUDE.md) with @-import resolution
  const projectInstructions = loadProjectInstructions(cwd)

  debug.context("memory", memoryContext ? "loaded" : "empty")
  debug.context("instructions", projectInstructions ? "loaded from project" : "none")

  return {
    techStack,
    schemas,
    skills,
    docs,
    config: agentConfig,
    memoryContext,
    projectInstructions,
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
  } = options

  // 0. pre:prompt hook — can modify or block the task prompt
  let effectiveTask = task
  if (globalHooks.has("pre:prompt")) {
    const promptResult = await globalHooks.execute("pre:prompt", {
      event: "pre:prompt",
      task,
      cwd,
    })
    if (promptResult.blocked) {
      throw new Error(promptResult.message || "Blocked by pre:prompt hook")
    }
    if (promptResult.modified?.task) {
      effectiveTask = String(promptResult.modified.task)
    }
  }

  // 0b. pre:generate hook — can block the entire generation
  if (globalHooks.has("pre:generate")) {
    const genResult = await globalHooks.execute("pre:generate", {
      event: "pre:generate",
      task: effectiveTask,
      cwd,
    })
    if (genResult.blocked) {
      throw new Error(genResult.message || "Blocked by pre:generate hook")
    }
  }

  // 1. Gather context
  logger.info("Analyzing project...")
  const context = await createAgentContext(cwd, effectiveTask, {
    provider: providerName,
    context7: { enabled: context7, apiKey },
  })

  // 2. Resolve output type
  const outputType = resolveOutputType(options.outputType, effectiveTask)
  logger.info(`Output type: ${outputType}`)

  // 3. Match relevant skills
  const matchedSkills = matchSkillsToTask(context.skills, effectiveTask, outputType)
  if (matchedSkills.length) {
    logger.info(
      `Loaded ${matchedSkills.length} relevant skill(s): ${matchedSkills.map((m) => m.skill.frontmatter.name).join(", ")}`
    )
  }

  // 4. Build system prompt
  const systemPrompt = buildSystemPrompt(context, outputType, matchedSkills.map((m) => m.skill))

  // 5. Ensure credentials exist (auto-prompt if missing)
  const hasCredentials = await ensureCredentials(apiKey)
  if (!hasCredentials) {
    throw new Error("No credentials configured. Run `shadxn model` to set up.")
  }

  // 6. Create provider
  const provider = createProvider(providerName, apiKey)
  const resolvedModel = model || loadAuthConfig()?.model

  // Build initial messages (without system — orchestrator handles it)
  const sessionMessages: GenerationMessage[] = [
    ...(options.sessionMessages || []),
    { role: "user", content: effectiveTask },
  ]

  logger.info("Generating...")

  // Determine if we should use the agentic loop
  const useAgentic = supportsAgenticLoop(provider)
  const maxSteps = options.maxSteps ?? (useAgentic ? 20 : 5)

  // 7. Run orchestrator (agentic or legacy)
  const agenticResult = await runAgenticLoop({
    provider,
    systemPrompt,
    messages: [
      { role: "system", content: systemPrompt },
      ...sessionMessages,
    ],
    providerOptions: { model: resolvedModel, maxTokens: 8192 },
    cwd,
    maxIterations: maxSteps,
    enabledTools: context.config.agentic.enabledTools.filter(
      (t) => !context.config.agentic.disabledTools.includes(t)
    ),
    interactive,
    overwrite,
    dryRun,
    onProgress: (event) => {
      if (event.type === "iteration_start" && event.iteration > 1) {
        logger.info(`Step ${event.iteration}/${maxSteps}...`)
      }
      if (event.type === "tool_call") {
        debug.step(0, `Tool: ${event.name}`)
      }
    },
  })

  // Track token usage
  if (agenticResult.tokensUsed) {
    const stepModel = resolvedModel || "claude-sonnet-4-20250514"
    const estInput = Math.round(agenticResult.tokensUsed * 0.3)
    const estOutput = agenticResult.tokensUsed - estInput
    globalTracker.recordStep(1, stepModel, estInput, estOutput)
  }

  let { content } = agenticResult
  const { followUp, tokensUsed: totalTokens } = agenticResult

  if (agenticResult.iterations > 1) {
    logger.info(`Completed in ${agenticResult.iterations} step(s)`)
  }

  // post:response hook — can modify or block the AI response
  if (globalHooks.has("post:response")) {
    const responseResult = await globalHooks.execute("post:response", {
      event: "post:response",
      content,
      task: effectiveTask,
      cwd,
    })
    if (responseResult.blocked) {
      throw new Error(responseResult.message || "Blocked by post:response hook")
    }
    if (responseResult.modified?.content) {
      content = String(responseResult.modified.content)
    }
  }

  // Handle follow-up questions (interactive mode)
  if (followUp && interactive) {
    return {
      files: { written: [], skipped: [], errors: [] },
      content,
      outputType,
      followUp,
      tokensUsed: totalTokens,
    }
  }

  // Deduplicate files (later versions override earlier ones)
  const deduped = new Map<string, import("./providers/types").GeneratedFile>()
  for (const file of agenticResult.files) {
    deduped.set(file.path, file)
  }

  // Write files
  const outputDir = resolveOutputDir(outputType, context.techStack, options.outputDir)

  const writeResult = await writeGeneratedFiles(Array.from(deduped.values()), {
    cwd,
    overwrite,
    dryRun,
    outputDir,
  })

  // Heal loop — verify generated code and auto-fix if needed
  let healResult: import("@/src/runtime/heal").HealResult | undefined
  if (options.heal !== false && !dryRun && writeResult.written.length > 0) {
    const { HealEngine } = await import("@/src/runtime/heal")
    const healEngine = new HealEngine(cwd, {
      enabled: true,
      testCommand: options.healConfig?.testCommand,
      buildCommand: options.healConfig?.buildCommand,
      lintCommand: options.healConfig?.lintCommand,
      maxAttempts: options.healConfig?.maxAttempts ?? 3,
      provider: providerName,
      model: resolvedModel,
      apiKey,
    })
    healResult = await healEngine.detectAndHeal(writeResult.written, effectiveTask)

    if (!healResult.healed && healResult.error) {
      await globalHooks.execute("on:error", {
        event: "on:error",
        error: new Error(healResult.error),
        task: effectiveTask,
        cwd,
      })
    }
  }

  // post:generate hook — post-processing (format, lint, etc.)
  if (globalHooks.has("post:generate")) {
    await globalHooks.execute("post:generate", {
      event: "post:generate",
      task: effectiveTask,
      content,
      cwd,
    })
  }

  return {
    files: writeResult,
    content,
    outputType,
    tokensUsed: totalTokens,
    healResult,
  }
}

// --- Streaming generation ---

export type GenerateStreamEvent =
  | StreamEvent
  | { type: "context_ready"; outputType: OutputType }
  | { type: "step_complete"; step: number; filesCount: number }
  | { type: "tool_call"; name: string; id: string }
  | { type: "tool_result"; name: string; id: string; is_error?: boolean }
  | { type: "iteration"; iteration: number }
  | { type: "generate_result"; result: GenerateResult }

export async function* generateStream(
  options: GenerateOptions
): AsyncGenerator<GenerateStreamEvent> {
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
  } = options

  // 0. pre:prompt hook
  let effectiveTask = task
  if (globalHooks.has("pre:prompt")) {
    const promptResult = await globalHooks.execute("pre:prompt", {
      event: "pre:prompt",
      task,
      cwd,
    })
    if (promptResult.blocked) {
      yield { type: "error", error: promptResult.message || "Blocked by pre:prompt hook" }
      return
    }
    if (promptResult.modified?.task) {
      effectiveTask = String(promptResult.modified.task)
    }
  }

  // 0b. pre:generate hook
  if (globalHooks.has("pre:generate")) {
    const genResult = await globalHooks.execute("pre:generate", {
      event: "pre:generate",
      task: effectiveTask,
      cwd,
    })
    if (genResult.blocked) {
      yield { type: "error", error: genResult.message || "Blocked by pre:generate hook" }
      return
    }
  }

  // 1. Gather context
  const context = await createAgentContext(cwd, effectiveTask, {
    provider: providerName,
    context7: { enabled: context7, apiKey },
  })

  // 2. Resolve output type
  const outputType = resolveOutputType(options.outputType, effectiveTask)

  // Signal context ready so UI can stop spinner
  yield { type: "context_ready", outputType }

  // 3. Match relevant skills
  const matchedSkills = matchSkillsToTask(context.skills, effectiveTask, outputType)

  // 4. Build system prompt
  const systemPrompt = buildSystemPrompt(context, outputType, matchedSkills.map((m) => m.skill))

  // 5. Ensure credentials
  const hasCredentials = await ensureCredentials(apiKey)
  if (!hasCredentials) {
    yield { type: "error", error: "No credentials configured. Run `shadxn model` to set up." }
    return
  }

  // 6. Create provider
  const provider = createProvider(providerName, apiKey)
  const resolvedModel = model || loadAuthConfig()?.model
  const useAgentic = supportsAgenticLoop(provider)
  const maxSteps = options.maxSteps ?? (useAgentic ? 20 : 5)

  const sessionMessages: GenerationMessage[] = [
    ...(options.sessionMessages || []),
    { role: "user", content: effectiveTask },
  ]

  // For agentic mode, use the orchestrator with progress events
  if (useAgentic) {
    const q = new AsyncQueue<GenerateStreamEvent>()
    let agenticResult: Awaited<ReturnType<typeof runAgenticLoop>> | undefined
    let agenticError: unknown

    const agenticPromise = (async () => {
      try {
        agenticResult = await runAgenticLoop({
          provider,
          systemPrompt,
          messages: [
            { role: "system", content: systemPrompt },
            ...sessionMessages,
          ],
          providerOptions: { model: resolvedModel, maxTokens: 8192 },
          cwd,
          maxIterations: maxSteps,
          enabledTools: context.config.agentic.enabledTools.filter(
            (t) => !context.config.agentic.disabledTools.includes(t)
          ),
          interactive,
          overwrite,
          dryRun,
          onProgress: (event) => {
            if (event.type === "text_delta") {
              q.push({ type: "text_delta", text: event.text })
            }
            if (event.type === "iteration_start") {
              q.push({ type: "iteration", iteration: event.iteration })
            }
            if (event.type === "tool_call") {
              q.push({ type: "tool_call", name: event.name, id: event.id })
            }
            if (event.type === "tool_result") {
              q.push({ type: "tool_result", name: event.name, id: event.id, is_error: event.is_error })
            }
            if (event.type === "files_created") {
              q.push({ type: "step_complete", step: 0, filesCount: event.files.length })
            }
          },
        })
      } catch (err) {
        agenticError = err
      } finally {
        q.close()
      }
    })()

    for await (const evt of q) {
      yield evt
    }

    await agenticPromise
    if (agenticError) {
      const msg = agenticError instanceof Error ? agenticError.message : String(agenticError)
      yield { type: "error", error: msg }
      return
    }
    if (!agenticResult) {
      yield { type: "error", error: "Agentic loop failed without a result" }
      return
    }

    yield {
      type: "done",
      result: {
        content: agenticResult.content,
        files: agenticResult.files,
        tokensUsed: agenticResult.tokensUsed,
        followUp: agenticResult.followUp,
      },
    }

    // Write files and heal
    let { content } = agenticResult

    // post:response hook
    if (globalHooks.has("post:response")) {
      const responseResult = await globalHooks.execute("post:response", {
        event: "post:response",
        content,
        task: effectiveTask,
        cwd,
      })
      if (responseResult.blocked) {
        yield { type: "error", error: responseResult.message || "Blocked by post:response hook" }
        return
      }
      if (responseResult.modified?.content) {
        content = String(responseResult.modified.content)
      }
    }

    if (agenticResult.followUp && interactive) {
      yield {
        type: "generate_result",
        result: {
          files: { written: [], skipped: [], errors: [] },
          content,
          outputType,
          followUp: agenticResult.followUp,
          tokensUsed: agenticResult.tokensUsed,
        },
      }
      return
    }

    const deduped = new Map<string, import("./providers/types").GeneratedFile>()
    for (const file of agenticResult.files) {
      deduped.set(file.path, file)
    }

    const outputDir = resolveOutputDir(outputType, context.techStack, options.outputDir)
    const writeResult = await writeGeneratedFiles(Array.from(deduped.values()), {
      cwd,
      overwrite,
      dryRun,
      outputDir,
    })

    let healResult: import("@/src/runtime/heal").HealResult | undefined
    if (options.heal !== false && !dryRun && writeResult.written.length > 0) {
      const { HealEngine } = await import("@/src/runtime/heal")
      const healEngine = new HealEngine(cwd, {
        enabled: true,
        testCommand: options.healConfig?.testCommand,
        buildCommand: options.healConfig?.buildCommand,
        lintCommand: options.healConfig?.lintCommand,
        maxAttempts: options.healConfig?.maxAttempts ?? 3,
        provider: providerName,
        model: resolvedModel,
        apiKey,
      })
      healResult = await healEngine.detectAndHeal(writeResult.written, effectiveTask)
    }

    if (globalHooks.has("post:generate")) {
      await globalHooks.execute("post:generate", {
        event: "post:generate",
        task: effectiveTask,
        content,
        cwd,
      })
    }

    yield {
      type: "generate_result",
      result: {
        files: writeResult,
        content,
        outputType,
        tokensUsed: agenticResult.tokensUsed,
        healResult,
      },
    }
    return
  }

  // --- Legacy streaming path (no generateRaw) ---

  const messages: GenerationMessage[] = [
    { role: "system", content: systemPrompt },
    ...sessionMessages,
  ]

  const allFiles: import("./providers/types").GeneratedFile[] = []
  let totalTokens = 0
  let content = ""
  let followUp: string | undefined
  let step = 0

  // --- Step 1: streamed ---
  step++
  debug.step(step, `Starting generation (model: ${resolvedModel || "default"})`)

  let step1Result: GenerationResult

  if (provider.stream) {
    let accumulated = ""
    let streamResult: GenerationResult | undefined

    for await (const event of provider.stream(messages, {
      model: resolvedModel,
      maxTokens: 8192,
    })) {
      yield event

      if (event.type === "text_delta") {
        accumulated += event.text
      }
      if (event.type === "done") {
        streamResult = event.result
      }
    }

    step1Result = streamResult || {
      content: accumulated,
      files: [],
      tokensUsed: 0,
    }
  } else {
    const result = await provider.generate(messages, {
      model: resolvedModel,
      maxTokens: 8192,
    })

    if (result.content) {
      yield { type: "text_delta", text: result.content }
    }
    yield { type: "done", result }
    step1Result = result
  }

  totalTokens += step1Result.tokensUsed || 0
  content = step1Result.content

  const step1Tokens = step1Result.tokensUsed || 0
  const step1Model = resolvedModel || "claude-sonnet-4-20250514"
  const estInput1 = Math.round(step1Tokens * 0.3)
  const estOutput1 = step1Tokens - estInput1
  globalTracker.recordStep(step, step1Model, estInput1, estOutput1)
  debug.api("generate", step1Model, step1Tokens)
  debug.step(step, `Generated ${step1Result.files.length} file(s), ${step1Tokens} tokens`)

  if (step1Result.files.length) {
    allFiles.push(...step1Result.files)
  }

  if (step1Result.followUp) {
    followUp = step1Result.followUp
  }

  yield { type: "step_complete", step, filesCount: step1Result.files.length }

  // --- Steps 2-N: non-streaming continuation loop ---
  if (!followUp) {
    const wantsContinuation1 =
      content.includes("[CONTINUE]") ||
      content.includes("Next, I'll") ||
      content.includes("Now let me") ||
      content.includes("I'll also generate")

    if (wantsContinuation1 && step1Result.files.length > 0) {
      const filesSummary = step1Result.files
        .map((f) => `Created: ${f.path}${f.description ? ` — ${f.description}` : ""}`)
        .join("\n")
      messages.push({
        role: "assistant",
        content: content + (filesSummary ? `\n\nFiles created:\n${filesSummary}` : ""),
      })
      messages.push({
        role: "user",
        content:
          "Continue generating the remaining files. Build on what you've already created. When finished, do not include [CONTINUE] in your response.",
      })

      while (step < maxSteps) {
        step++
        debug.step(step, `Starting generation (model: ${resolvedModel || "default"})`)

        const result = await provider.generate(messages, {
          model: resolvedModel,
          maxTokens: 8192,
        })

        totalTokens += result.tokensUsed || 0
        content = result.content

        const stepTokens = result.tokensUsed || 0
        const stepModel = resolvedModel || "claude-sonnet-4-20250514"
        const estInput = Math.round(stepTokens * 0.3)
        const estOutput = stepTokens - estInput
        globalTracker.recordStep(step, stepModel, estInput, estOutput)
        debug.api("generate", stepModel, stepTokens)
        debug.step(step, `Generated ${result.files.length} file(s), ${stepTokens} tokens`)

        if (result.files.length) {
          allFiles.push(...result.files)
        }

        yield { type: "step_complete", step, filesCount: result.files.length }

        if (result.followUp) {
          followUp = result.followUp
          break
        }
        if (result.files.length === 0 && step > 1) break

        const wantsContinuation =
          result.content.includes("[CONTINUE]") ||
          result.content.includes("Next, I'll") ||
          result.content.includes("Now let me") ||
          result.content.includes("I'll also generate")

        if (!wantsContinuation) break

        const filesSummary2 = result.files
          .map((f) => `Created: ${f.path}${f.description ? ` — ${f.description}` : ""}`)
          .join("\n")
        messages.push({
          role: "assistant",
          content: result.content + (filesSummary2 ? `\n\nFiles created:\n${filesSummary2}` : ""),
        })
        messages.push({
          role: "user",
          content:
            "Continue generating the remaining files. Build on what you've already created. When finished, do not include [CONTINUE] in your response.",
        })
      }
    }
  }

  // post:response hook
  if (globalHooks.has("post:response")) {
    const responseResult = await globalHooks.execute("post:response", {
      event: "post:response",
      content,
      task: effectiveTask,
      cwd,
    })
    if (responseResult.blocked) {
      yield { type: "error", error: responseResult.message || "Blocked by post:response hook" }
      return
    }
    if (responseResult.modified?.content) {
      content = String(responseResult.modified.content)
    }
  }

  if (followUp && interactive) {
    yield {
      type: "generate_result",
      result: {
        files: { written: [], skipped: [], errors: [] },
        content,
        outputType,
        followUp,
        tokensUsed: totalTokens,
      },
    }
    return
  }

  const deduped = new Map<import("./providers/types").GeneratedFile["path"], import("./providers/types").GeneratedFile>()
  for (const file of allFiles) {
    deduped.set(file.path, file)
  }

  const outputDir = resolveOutputDir(outputType, context.techStack, options.outputDir)
  const writeResult = await writeGeneratedFiles(Array.from(deduped.values()), {
    cwd,
    overwrite,
    dryRun,
    outputDir,
  })

  let healResult: import("@/src/runtime/heal").HealResult | undefined
  if (options.heal !== false && !dryRun && writeResult.written.length > 0) {
    const { HealEngine } = await import("@/src/runtime/heal")
    const healEngine = new HealEngine(cwd, {
      enabled: true,
      testCommand: options.healConfig?.testCommand,
      buildCommand: options.healConfig?.buildCommand,
      lintCommand: options.healConfig?.lintCommand,
      maxAttempts: options.healConfig?.maxAttempts ?? 3,
      provider: providerName,
      model: resolvedModel,
      apiKey,
    })
    healResult = await healEngine.detectAndHeal(writeResult.written, effectiveTask)

    if (!healResult.healed && healResult.error) {
      await globalHooks.execute("on:error", {
        event: "on:error",
        error: new Error(healResult.error),
        task: effectiveTask,
        cwd,
      })
    }
  }

  if (globalHooks.has("post:generate")) {
    await globalHooks.execute("post:generate", {
      event: "post:generate",
      task: effectiveTask,
      content,
      cwd,
    })
  }

  yield {
    type: "generate_result",
    result: {
      files: writeResult,
      content,
      outputType,
      tokensUsed: totalTokens,
      healResult,
    },
  }
}

function buildSystemPrompt(
  context: AgentContext,
  outputType: string,
  skills: Skill[]
): string {
  const sections: string[] = []

  // Identity — updated for agentic capabilities
  sections.push(`You are shadxn, an agentic code generation tool. You generate high-quality, production-ready output for any tech stack.

Your primary tool is \`create_files\` — use it to output all generated code, documents, and configs as files.
If the request is ambiguous or you need critical information to proceed correctly, use \`ask_user\` to ask a clarifying question.

You also have tools to inspect the codebase before generating code:
- \`read_file\` — read existing files to understand patterns, styles, and implementations
- \`search_files\` — search for files by glob pattern, optionally grep content with regex
- \`list_directory\` — explore the project structure
- \`run_command\` — run shell commands (build, test, lint, etc.)
- \`edit_file\` — apply targeted search/replace edits to existing files

AGENTIC WORKFLOW:
- Before generating code, use \`read_file\` and \`search_files\` to understand the existing codebase
- Match the project's existing patterns, naming conventions, and code style
- After creating files, consider running tests or build commands to verify correctness
- Use \`edit_file\` for small, targeted changes instead of rewriting entire files

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

  // Project instructions (SHADXN.md / CLAUDE.md)
  if (context.projectInstructions) {
    sections.push(`# Project Instructions\n${context.projectInstructions}`)
  }

  // Memory context (past generations, patterns, preferences)
  if (context.memoryContext) {
    sections.push(context.memoryContext)
  }

  // Output type guidance
  sections.push(`# Output Type: ${outputType}\nGenerate output appropriate for: ${outputType}. Use the \`create_files\` tool to output all files.`)

  return sections.join("\n\n")
}

// Re-export key types
export type { TechStack } from "./context/tech-stack"
export type { ProjectSchemas } from "./context/schema"
export type { Skill } from "./skills/types"
export type { AgentConfig, OutputType, GeneratedFile, StreamEvent } from "./providers/types"
