import type {
  AgentProvider,
  GenerationMessage,
  GenerationResult,
  GeneratedFile,
  ProviderOptions,
} from "./types"
import { execSync, type ExecSyncOptionsWithStringEncoding } from "child_process"

// --- Claude Code provider: uses the `claude` CLI (works with your Claude subscription) ---

export class ClaudeCodeProvider implements AgentProvider {
  name = "claude-code"

  constructor() {
    // Verify claude CLI is available
    try {
      execSync("claude --version", { stdio: "pipe" })
    } catch {
      throw new Error(
        "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code\n" +
          "Then authenticate with: claude login\n" +
          "This uses your Claude subscription — no API key needed."
      )
    }
  }

  async generate(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult> {
    // Build the prompt from messages
    const systemMsg = messages.find((m) => m.role === "system")
    const userMsgs = messages.filter((m) => m.role !== "system")

    // Construct a single prompt that includes system context and conversation
    const parts: string[] = []

    if (systemMsg) {
      parts.push(systemMsg.content)
    }

    // Add instruction to output structured JSON for file generation
    parts.push(`
CRITICAL OUTPUT FORMAT INSTRUCTION:
You MUST respond with a valid JSON object and NOTHING else. No markdown fences, no explanation outside the JSON.
The JSON must have this exact structure:
{
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "full file content here",
      "language": "typescript",
      "description": "what this file does"
    }
  ],
  "summary": "brief summary of what was generated",
  "followUp": null
}

If you need to ask the user a clarifying question instead of generating files, respond with:
{
  "files": [],
  "summary": "",
  "followUp": "your question here"
}

Remember: Output ONLY the JSON object. No other text.`)

    // Add conversation messages
    for (const msg of userMsgs) {
      if (msg.role === "user") {
        parts.push(`\nUser request: ${msg.content}`)
      } else if (msg.role === "assistant") {
        parts.push(`\nPrevious assistant response: ${msg.content}`)
      }
    }

    const fullPrompt = parts.join("\n\n")

    // Use claude CLI in print mode (-p flag) with --output-format for structured output
    const result = this.runClaude(fullPrompt, options)

    return this.parseResponse(result)
  }

  private runClaude(prompt: string, options?: ProviderOptions): string {
    // Build the command - use -p for print mode (non-interactive, single prompt)
    // --output-format json gives us structured output
    const args: string[] = ["-p", "--output-format", "json"]

    // Add model if specified
    if (options?.model) {
      args.push("--model", options.model)
    }

    // Add max tokens if specified
    if (options?.maxTokens) {
      args.push("--max-turns", "1")
    }

    const cmd = `claude ${args.join(" ")}`

    try {
      const execOpts: ExecSyncOptionsWithStringEncoding = {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
        timeout: 300000, // 5 min timeout
        input: prompt,
        stdio: ["pipe", "pipe", "pipe"],
      }

      const output = execSync(cmd, execOpts)
      return output.toString().trim()
    } catch (error: any) {
      if (error.status === 127) {
        throw new Error(
          "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
        )
      }
      // If the command ran but returned non-zero, stderr might have the error
      if (error.stderr) {
        const stderr = error.stderr.toString()
        if (stderr.includes("not logged in") || stderr.includes("auth")) {
          throw new Error(
            "Claude Code not authenticated. Run: claude login"
          )
        }
        throw new Error(`Claude Code error: ${stderr}`)
      }
      // If there's stdout even on error, try to use it
      if (error.stdout) {
        return error.stdout.toString().trim()
      }
      throw new Error(`Claude Code failed: ${error.message}`)
    }
  }

  private parseResponse(raw: string): GenerationResult {
    const files: GeneratedFile[] = []
    let content = ""
    let followUp: string | undefined

    // The claude CLI with --output-format json returns a JSON object with a "result" field
    try {
      const outer = JSON.parse(raw)
      // Claude CLI JSON output format: { result: "..." , ... }
      const text = outer.result || outer.content || outer.text || raw

      // Now try to parse the inner content as our structured format
      return this.parseStructuredOutput(typeof text === "string" ? text : JSON.stringify(text))
    } catch {
      // Not valid JSON wrapper, try direct parse
    }

    // Try to parse as our structured JSON format directly
    try {
      return this.parseStructuredOutput(raw)
    } catch {
      // Not structured JSON
    }

    // Try to extract JSON from markdown code blocks
    const jsonBlockMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/)
    if (jsonBlockMatch) {
      try {
        return this.parseStructuredOutput(jsonBlockMatch[1])
      } catch {
        // Not valid JSON in code block
      }
    }

    // Fallback: try to extract any JSON object from the response
    const jsonMatch = raw.match(/\{[\s\S]*"files"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return this.parseStructuredOutput(jsonMatch[0])
      } catch {
        // Not valid JSON
      }
    }

    // Last resort: return as plain text content
    content = raw
    return { content, files, followUp, tokensUsed: undefined }
  }

  private parseStructuredOutput(text: string): GenerationResult {
    const data = JSON.parse(text)
    const files: GeneratedFile[] = []

    if (Array.isArray(data.files)) {
      for (const f of data.files) {
        if (f.path && f.content) {
          files.push({
            path: f.path,
            content: f.content,
            language: f.language,
            description: f.description,
          })
        }
      }
    }

    return {
      content: data.summary || "",
      files,
      followUp: data.followUp || undefined,
      tokensUsed: undefined, // Claude CLI doesn't expose token count
    }
  }
}
