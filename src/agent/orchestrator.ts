// --- Agentic Orchestrator: tool_result feedback loop ---

import type {
  AgentProvider,
  GenerationMessage,
  GeneratedFile,
  ProviderOptions,
  AnthropicMessage,
  ContentBlock,
  RawGenerationResult,
} from "./providers/types"
import { ToolExecutor, type ToolResult } from "./tools"
import { getAnthropicTools, formatToolsForSystemPrompt } from "./tools"
import { debug } from "@/src/observability"

export interface AgenticLoopOptions {
  provider: AgentProvider
  systemPrompt: string
  messages: GenerationMessage[]
  providerOptions: ProviderOptions
  cwd: string
  maxIterations?: number
  enabledTools?: string[]
  interactive?: boolean
  overwrite?: boolean
  dryRun?: boolean
  onProgress?: (event: AgenticProgressEvent) => void
}

export type AgenticProgressEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "tool_call"; name: string; id: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; id: string; content: string; is_error?: boolean }
  | { type: "text_delta"; text: string }
  | { type: "files_created"; files: GeneratedFile[] }
  | { type: "complete"; iterations: number; totalTokens: number }

export interface AgenticResult {
  files: GeneratedFile[]
  content: string
  followUp?: string
  tokensUsed: number
  iterations: number
}

/**
 * Run the agentic tool_result loop.
 * The LLM decides what tools to call (read files, search, edit, etc.)
 * and we feed results back until it signals completion.
 */
export async function runAgenticLoop(options: AgenticLoopOptions): Promise<AgenticResult> {
  const {
    provider,
    systemPrompt,
    messages: inputMessages,
    providerOptions,
    cwd,
    maxIterations = 20,
    enabledTools,
    interactive = true,
    overwrite = false,
    dryRun = false,
    onProgress,
  } = options

  // Check if provider supports generateRaw
  if (!provider.generateRaw) {
    return runLegacyLoop(options)
  }

  const executor = new ToolExecutor(cwd, { interactive, overwrite, dryRun })
  const tools = getAnthropicTools(enabledTools)

  // Convert GenerationMessage[] to AnthropicMessage[] (strip system messages)
  const anthropicMessages: AnthropicMessage[] = inputMessages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

  const allFiles: GeneratedFile[] = []
  let totalTokens = 0
  let textContent = ""
  let followUp: string | undefined
  let iteration = 0

  while (iteration < maxIterations) {
    iteration++
    onProgress?.({ type: "iteration_start", iteration })
    debug.step(iteration, `Agentic loop iteration (${tools.length} tools available)`)

    let result: RawGenerationResult
    try {
      result = await provider.generateRaw(
        anthropicMessages,
        systemPrompt,
        tools,
        providerOptions
      )
    } catch (error: any) {
      // If generateRaw fails (e.g., OAuth mode), fall back to legacy
      if (error.message?.includes("not available")) {
        return runLegacyLoop(options)
      }
      throw error
    }

    totalTokens += result.usage.input_tokens + result.usage.output_tokens

    // Collect text from response
    for (const block of result.content) {
      if (block.type === "text") {
        textContent += block.text
        onProgress?.({ type: "text_delta", text: block.text })
      }
    }

    // If stop_reason is end_turn or max_tokens, we're done
    if (result.stop_reason === "end_turn" || result.stop_reason === "max_tokens") {
      break
    }

    // If stop_reason is tool_use, execute the tools
    if (result.stop_reason === "tool_use") {
      const toolUseBlocks = result.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      )

      if (toolUseBlocks.length === 0) break

      // Append assistant message with the tool_use blocks
      anthropicMessages.push({
        role: "assistant",
        content: result.content,
      })

      // Execute each tool and collect results
      const toolResults: ContentBlock[] = []

      for (const toolBlock of toolUseBlocks) {
        onProgress?.({
          type: "tool_call",
          name: toolBlock.name,
          id: toolBlock.id,
          input: toolBlock.input,
        })

        debug.step(iteration, `Tool call: ${toolBlock.name}`)

        const toolResult = await executor.execute({
          name: toolBlock.name,
          id: toolBlock.id,
          input: toolBlock.input,
        })

        onProgress?.({
          type: "tool_result",
          name: toolBlock.name,
          id: toolBlock.id,
          content: toolResult.content.slice(0, 200),
          is_error: toolResult.is_error,
        })

        // Collect files from create_files calls
        if (toolResult.files?.length) {
          allFiles.push(...toolResult.files)
          onProgress?.({ type: "files_created", files: toolResult.files })
        }

        // Handle ask_user — surface the question to caller
        if (toolResult.followUp) {
          followUp = toolResult.followUp
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolResult.tool_use_id,
          content: toolResult.content,
          is_error: toolResult.is_error,
        })
      }

      // Append user message with tool_result blocks
      anthropicMessages.push({
        role: "user",
        content: toolResults,
      })

      // If we got a follow-up question, break the loop to surface it
      if (followUp) break

      continue
    }

    // Unknown stop_reason — break
    break
  }

  onProgress?.({ type: "complete", iterations: iteration, totalTokens })

  return {
    files: allFiles,
    content: textContent,
    followUp,
    tokensUsed: totalTokens,
    iterations: iteration,
  }
}

/**
 * Fallback to the legacy [CONTINUE]-based multi-step loop.
 * Used when provider doesn't support generateRaw() (CLI/OAuth mode).
 * For CLI mode, we include tool descriptions in the system prompt so the
 * `claude` binary uses its own built-in tools (read, write, bash, etc.).
 */
async function runLegacyLoop(options: AgenticLoopOptions): Promise<AgenticResult> {
  const {
    provider,
    systemPrompt,
    messages: inputMessages,
    providerOptions,
    maxIterations = 5,
  } = options

  // Enhance system prompt with tool descriptions for CLI mode
  const enhancedSystemPrompt = systemPrompt + "\n\n" + formatToolsForSystemPrompt()

  const messages: GenerationMessage[] = [
    { role: "system", content: enhancedSystemPrompt },
    ...inputMessages.filter((m) => m.role !== "system"),
  ]

  const allFiles: GeneratedFile[] = []
  let totalTokens = 0
  let content = ""
  let followUp: string | undefined
  let step = 0

  while (step < maxIterations) {
    step++
    debug.step(step, `Legacy loop step (model: ${providerOptions.model || "default"})`)

    const result = await provider.generate(messages, providerOptions)

    totalTokens += result.tokensUsed || 0
    content = result.content

    if (result.files.length) {
      allFiles.push(...result.files)
    }

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

  return {
    files: allFiles,
    content,
    followUp,
    tokensUsed: totalTokens,
    iterations: step,
  }
}

/**
 * Check if a provider supports the agentic loop (has generateRaw).
 */
export function supportsAgenticLoop(provider: AgentProvider): boolean {
  return typeof provider.generateRaw === "function"
}
