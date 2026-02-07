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
import { resolveToken, loadAuthConfig } from "@/src/utils/auth-store"
import { execa } from "execa"
import { getLegacyTools } from "../tools/definitions"

// --- Claude Code provider: uses Claude CLI (subscription) or direct API (API key) ---

const DEFAULT_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_MAX_TOKENS = 8192

// Model ID → claude CLI alias
const CLI_MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4-20250514": "sonnet",
  "claude-opus-4-20250514": "opus",
  "claude-haiku-4-20250514": "haiku",
}

type AuthCredential = { type: "oauth"; token: string } | { type: "api-key"; token: string }

interface AnthropicResponse {
  id: string
  content: Array<{
    type: "text" | "tool_use" | "tool_result"
    text?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }>
  model: string
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

export class ClaudeCodeProvider implements AgentProvider {
  name = "claude-code"
  private credential: AuthCredential

  constructor() {
    // Stored config takes priority — if user ran `shadxn model` and chose OAuth,
    // we use that regardless of ANTHROPIC_API_KEY env var (same as OpenClaw's clearEnv).
    const stored = loadAuthConfig()
    if (stored) {
      this.credential = { type: stored.authType, token: stored.token }
      return
    }

    const resolved = resolveToken()
    if (!resolved) {
      throw new Error(
        "No Claude credentials found.\n" +
          "Options:\n" +
          "  1. Run `shadxn model` to configure credentials\n" +
          "  2. Set ANTHROPIC_API_KEY environment variable\n" +
          "  3. Set ANTHROPIC_OAUTH_TOKEN environment variable"
      )
    }
    this.credential = { type: resolved.authType, token: resolved.token }
  }

  async generate(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult> {
    // OAuth tokens → use claude CLI (subscription billing)
    // API keys → call API directly
    if (this.credential.type === "oauth") {
      return this.generateViaCli(messages, options)
    }
    return this.generateViaApi(messages, options)
  }

  /**
   * generateRaw() for the agentic tool_result loop.
   * Only available for API key auth — the CLI binary has its own agent loop.
   */
  async generateRaw(
    messages: AnthropicMessage[],
    systemPrompt: string,
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    options?: ProviderOptions
  ): Promise<RawGenerationResult> {
    // OAuth path: not supported — the claude CLI has its own built-in tools
    if (this.credential.type === "oauth") {
      throw new Error("generateRaw() not available for OAuth/CLI mode")
    }

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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": this.credential.token,
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${errorText}`)
    }

    const response = (await res.json()) as AnthropicResponse

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

  /**
   * Returns true if this provider can use the agentic tool loop.
   * Only available for API key auth (CLI mode falls back to legacy loop).
   */
  get supportsAgenticLoop(): boolean {
    return this.credential.type === "api-key"
  }

  /**
   * Generate via the `claude` CLI binary.
   * This is how subscription billing works — the CLI handles auth internally.
   */
  private async generateViaCli(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult> {
    const model = options?.model || loadAuthConfig()?.model || DEFAULT_MODEL
    const cliModel = CLI_MODEL_ALIASES[model] || model

    const systemMsg = messages.find((m) => m.role === "system")
    const userMsgs = messages.filter((m) => m.role === "user")
    const prompt = userMsgs.map((m) => m.content).join("\n\n")

    const args = [
      "-p",
      "--output-format", "json",
      "--model", cliModel,
      "--dangerously-skip-permissions",
    ]

    if (systemMsg) {
      args.push("--append-system-prompt", systemMsg.content)
    }

    // Prompt goes as the last positional argument
    args.push(prompt)

    // Clear ANTHROPIC_API_KEY to force CLI to use subscription auth
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_API_KEY_OLD

    const result = await execa("claude", args, {
      env,
      extendEnv: false,
      reject: false,
      timeout: 300_000,
      stdin: "ignore",
    })

    if (result.exitCode !== 0) {
      const err = result.stderr || result.stdout || "Claude CLI failed"
      throw new Error(`Claude CLI error: ${err}`)
    }

    // Claude CLI may return success exit code but with is_error in JSON
    const output = result.stdout.trim()
    try {
      const json = JSON.parse(output)
      if (json.is_error && json.result) {
        throw new Error(json.result)
      }
    } catch (e: any) {
      if (e.message && !e.message.includes("JSON")) throw e
      // Not JSON — that's fine, parseCliOutput will handle it
    }

    return this.parseCliOutput(output)
  }

  /**
   * Generate via direct Anthropic API call (for API key auth).
   */
  private async generateViaApi(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult> {
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
      tools: getLegacyTools(),
    }

    if (systemMsg) {
      body.system = systemMsg.content
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": this.credential.token,
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${errorText}`)
    }

    const response = (await res.json()) as AnthropicResponse
    return this.parseApiResponse(response)
  }

  /**
   * Stream responses. For OAuth, uses CLI with --output-format stream-json.
   * For API keys, uses SSE streaming.
   */
  async *stream(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): AsyncIterable<StreamEvent> {
    if (this.credential.type === "oauth") {
      // CLI streaming via --output-format stream-json
      yield* this.streamViaCli(messages, options)
    } else {
      // API streaming via SSE (same as ClaudeProvider.stream)
      yield* this.streamViaApi(messages, options)
    }
  }

  private async *streamViaCli(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || loadAuthConfig()?.model || DEFAULT_MODEL
    const cliModel = CLI_MODEL_ALIASES[model] || model

    const systemMsg = messages.find((m) => m.role === "system")
    const userMsgs = messages.filter((m) => m.role === "user")
    const prompt = userMsgs.map((m) => m.content).join("\n\n")

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--model", cliModel,
      "--dangerously-skip-permissions",
    ]

    if (systemMsg) {
      args.push("--append-system-prompt", systemMsg.content)
    }

    args.push(prompt)

    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_API_KEY_OLD

    const child = execa("claude", args, {
      env,
      extendEnv: false,
      reject: false,
      timeout: 300_000,
      stdin: "ignore",
    })

    let fullContent = ""

    if (child.stdout) {
      const decoder = new TextDecoder()
      const readable = child.stdout as unknown as AsyncIterable<Uint8Array>

      for await (const chunk of readable) {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
        // Stream JSON format: each line is a JSON object
        const lines = text.split("\n").filter(Boolean)
        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            if (event.type === "assistant" && event.message) {
              fullContent += event.message
              yield { type: "text_delta", text: event.message }
            } else if (event.type === "result") {
              fullContent = event.result || fullContent
            }
          } catch {
            // Not JSON, treat as raw text
            fullContent += line
            yield { type: "text_delta", text: line }
          }
        }
      }
    }

    await child

    const files = this.extractFilesFromText(fullContent)
    yield {
      type: "done",
      result: { content: fullContent, files, tokensUsed: 0 },
    }
  }

  private async *streamViaApi(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || DEFAULT_MODEL
    const maxTokens = options?.maxTokens || DEFAULT_MAX_TOKENS

    const systemMsg = messages.find((m) => m.role === "system")
    const conversationMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversationMsgs,
      tools: getLegacyTools(),
      stream: true,
    }

    if (systemMsg) body.system = systemMsg.content

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": this.credential.token,
    }

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
    let content = ""
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
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              content += event.delta.text
              yield { type: "text_delta", text: event.delta.text }
            }
            if (event.type === "message_delta" && event.usage) {
              tokensUsed = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
            }
          } catch {
            // Skip
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const files = this.extractFilesFromText(content)
    yield {
      type: "done",
      result: { content, files, tokensUsed },
    }
  }

  /**
   * Parse JSON output from the `claude` CLI.
   */
  private parseCliOutput(stdout: string): GenerationResult {
    let parsed: any
    try {
      parsed = JSON.parse(stdout)
    } catch {
      // CLI returned plain text
      return {
        content: stdout.trim(),
        files: [],
        tokensUsed: 0,
      }
    }

    // Claude CLI JSON format: { result: "...", session_id: "...", ... }
    const text = parsed.result || parsed.text || parsed.content || ""

    // Extract files from the text if it contains code blocks with file paths
    const files = this.extractFilesFromText(text)

    return {
      content: text,
      files,
      tokensUsed: parsed.usage
        ? (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0)
        : 0,
    }
  }

  /**
   * Extract file blocks from CLI text output.
   * Looks for patterns like: ```path/to/file.ts ... ```
   */
  private extractFilesFromText(text: string): GeneratedFile[] {
    const files: GeneratedFile[] = []
    // Match fenced code blocks with a file path hint on the opening line
    const pattern = /```[\w]*\s*([\w/._-]+\.\w+)\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1]
      const content = match[2]
      if (filePath && content) {
        files.push({ path: filePath, content: content.trimEnd() })
      }
    }
    return files
  }

  /**
   * Parse Anthropic API response (tool-use format).
   */
  private parseApiResponse(response: AnthropicResponse): GenerationResult {
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
