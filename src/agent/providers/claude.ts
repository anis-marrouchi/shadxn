import type {
  AgentProvider,
  GenerationMessage,
  GenerationResult,
  GeneratedFile,
  ProviderOptions,
  StreamEvent,
  AnthropicMessage,
  RawGenerationResult,
  ContentBlock,
} from "./types"
import { resolveToken } from "@/src/utils/auth-store"
import { getLegacyTools } from "../tools/definitions"

// --- Claude provider (default) using Anthropic SDK ---

const DEFAULT_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_MAX_TOKENS = 8192

interface AnthropicResponse {
  id: string
  content: Array<{
    type: "text" | "tool_use" | "tool_result"
    text?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
    tool_use_id?: string
    content?: string
  }>
  model: string
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

export class ClaudeProvider implements AgentProvider {
  name = "claude"
  private apiKey: string
  private authType: "api-key" | "oauth" = "api-key"

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || ""
    if (!this.apiKey) {
      // Fallback to auth store
      const resolved = resolveToken()
      if (resolved) {
        this.apiKey = resolved.token
        this.authType = resolved.authType
      }
    }
    if (!this.apiKey) {
      throw new Error(
        "Anthropic API key required. Run `shadxn model` to configure, set ANTHROPIC_API_KEY, or pass --api-key."
      )
    }
  }

  async generate(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult> {
    const model = options?.model || DEFAULT_MODEL
    const maxTokens = options?.maxTokens || DEFAULT_MAX_TOKENS

    // Extract system message
    const systemMsg = messages.find((m) => m.role === "system")
    const conversationMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversationMsgs,
      tools: getLegacyTools(),
    }

    if (systemMsg) {
      body.system = systemMsg.content
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await this.callApi(body)

    return this.parseResponse(response)
  }

  async generateRaw(
    messages: AnthropicMessage[],
    systemPrompt: string,
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    options?: ProviderOptions
  ): Promise<RawGenerationResult> {
    const model = options?.model || DEFAULT_MODEL
    const maxTokens = options?.maxTokens || DEFAULT_MAX_TOKENS

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools,
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await this.callApi(body)

    // Map response content blocks to our ContentBlock type
    const content: ContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text || "" }
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id || "",
          name: block.name || "",
          input: block.input || {},
        }
      }
      return { type: "text" as const, text: "" }
    })

    return {
      content,
      stop_reason: response.stop_reason as RawGenerationResult["stop_reason"],
      usage: response.usage,
    }
  }

  async *stream(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || DEFAULT_MODEL
    const maxTokens = options?.maxTokens || DEFAULT_MAX_TOKENS

    const systemMsg = messages.find((m) => m.role === "system")
    const conversationMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversationMsgs,
      stream: true,
      tools: getLegacyTools(),
    }

    if (systemMsg) {
      body.system = systemMsg.content
    }

    const headers = this.buildHeaders()

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorText = await res.text()
      yield { type: "error", error: `Anthropic API error (${res.status}): ${errorText}` }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      yield { type: "error", error: "No response body" }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ""
    const files: GeneratedFile[] = []
    let content = ""
    let followUp: string | undefined
    let tokensUsed = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") continue

          try {
            const event = JSON.parse(data)

            if (event.type === "content_block_start") {
              if (event.content_block?.type === "tool_use") {
                yield {
                  type: "tool_use_start",
                  name: event.content_block.name,
                  id: event.content_block.id,
                }
              }
            }

            if (event.type === "content_block_delta") {
              if (event.delta?.type === "text_delta") {
                content += event.delta.text
                yield { type: "text_delta", text: event.delta.text }
              }
              if (event.delta?.type === "input_json_delta") {
                yield { type: "tool_use_delta", json: event.delta.partial_json }
              }
            }

            if (event.type === "content_block_stop") {
              // Tool use blocks are complete
            }

            if (event.type === "message_delta") {
              if (event.usage) {
                tokensUsed = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
              }
            }

            if (event.type === "message_stop") {
              // Message complete
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    yield {
      type: "done",
      result: { content, files, followUp, tokensUsed },
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    }

    if (this.authType === "oauth") {
      headers["Authorization"] = `Bearer ${this.apiKey}`
      headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20"
      headers["user-agent"] = "claude-cli/2.1.2 (external, cli)"
      headers["x-app"] = "cli"
      headers["anthropic-dangerous-direct-browser-access"] = "true"
    } else {
      headers["x-api-key"] = this.apiKey
    }

    return headers
  }

  private async callApi(body: Record<string, unknown>): Promise<AnthropicResponse> {
    const headers = this.buildHeaders()

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${errorText}`)
    }

    return (await res.json()) as AnthropicResponse
  }

  private parseResponse(response: AnthropicResponse): GenerationResult {
    const files: GeneratedFile[] = []
    let content = ""
    let followUp: string | undefined

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text || ""
      }

      if (block.type === "tool_use") {
        if (block.name === "create_files" && block.input) {
          const input = block.input as {
            files: GeneratedFile[]
            summary?: string
          }
          files.push(...(input.files || []))
          if (input.summary) {
            content += `\n${input.summary}`
          }
        }

        if (block.name === "ask_user" && block.input) {
          const input = block.input as { question: string; options?: string[] }
          followUp = input.question
          if (input.options?.length) {
            followUp += `\nOptions: ${input.options.join(", ")}`
          }
        }
      }
    }

    return {
      content,
      files,
      followUp,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    }
  }
}
