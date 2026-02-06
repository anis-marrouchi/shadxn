import type {
  AgentProvider,
  GenerationMessage,
  GenerationResult,
  GeneratedFile,
  ProviderOptions,
} from "./types"
import { execSync } from "child_process"
import { execa } from "execa"
import { logger } from "@/src/utils/logger"

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
    const systemMsg = messages.find((m) => m.role === "system")
    const userMsgs = messages.filter((m) => m.role !== "system")

    const parts: string[] = []

    if (systemMsg) {
      parts.push(systemMsg.content)
    }

    // Instruct Claude to use code blocks with file paths — this is how it naturally responds
    parts.push(`
OUTPUT FORMAT:
For each file you generate, use a markdown code block with the file path as a comment on the first line.
Format each file like this:

\`\`\`language
// filepath: relative/path/to/file.ext
... full file content ...
\`\`\`

Always include the "// filepath:" comment as the FIRST line inside every code block.
For non-JS/TS files, use the appropriate comment syntax:
- Python: # filepath: path/to/file.py
- YAML/Shell: # filepath: path/to/file.yml
- HTML/XML: <!-- filepath: path/to/file.html -->
- CSS: /* filepath: path/to/file.css */

Generate complete, production-ready files. After the code blocks, add a brief summary of what was generated.`)

    for (const msg of userMsgs) {
      if (msg.role === "user") {
        parts.push(`\nUser request: ${msg.content}`)
      } else if (msg.role === "assistant") {
        parts.push(`\nPrevious assistant response: ${msg.content}`)
      }
    }

    const fullPrompt = parts.join("\n\n")

    const raw = await this.runClaude(fullPrompt, options)

    return this.parseResponse(raw)
  }

  private async runClaude(prompt: string, options?: ProviderOptions): Promise<string> {
    // Use -p for print mode (non-interactive) and --output-format json for structured wrapper
    const args: string[] = ["-p", "--output-format", "json", "--max-turns", "1"]

    if (options?.model) {
      args.push("--model", options.model)
    }

    try {
      const result = await execa("claude", args, {
        input: prompt,
        timeout: 300000, // 5 min timeout
        maxBuffer: 50 * 1024 * 1024,
        reject: false,
      })

      if (result.stdout) {
        return result.stdout.trim()
      }

      if (result.stderr) {
        const stderr = result.stderr
        if (stderr.includes("not logged in") || stderr.includes("auth")) {
          throw new Error("Claude Code not authenticated. Run: claude login")
        }
        // Some CLI versions write to stderr
        if (stderr.length > 50) {
          return stderr.trim()
        }
        throw new Error(`Claude Code error: ${stderr}`)
      }

      throw new Error("Claude Code returned no output")
    } catch (error: any) {
      if (error.message?.includes("ENOENT")) {
        throw new Error(
          "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
        )
      }
      throw error
    }
  }

  private parseResponse(raw: string): GenerationResult {
    // Step 1: Unwrap the Claude CLI JSON envelope { result: "..." }
    let text = raw
    try {
      const envelope = JSON.parse(raw)
      if (envelope.result && typeof envelope.result === "string") {
        text = envelope.result
      } else if (envelope.content && typeof envelope.content === "string") {
        text = envelope.content
      }
    } catch {
      // Not a JSON envelope, use raw text
    }

    // Step 2: Try to parse as our structured JSON format (in case Claude followed the JSON instruction)
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data.files) && data.files.length > 0) {
        const files: GeneratedFile[] = data.files
          .filter((f: any) => f.path && f.content)
          .map((f: any) => ({
            path: f.path,
            content: f.content,
            language: f.language,
            description: f.description,
          }))
        if (files.length > 0) {
          return {
            content: data.summary || "",
            files,
            followUp: data.followUp || undefined,
            tokensUsed: undefined,
          }
        }
      }
    } catch {
      // Not structured JSON — expected, continue to code block parsing
    }

    // Step 3: Extract files from markdown code blocks (the natural Claude response format)
    const files = this.extractFilesFromCodeBlocks(text)

    // Step 4: Build summary from non-code-block text
    const summary = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

    if (files.length === 0 && text.length > 0) {
      logger.warn("No files could be extracted from Claude's response.")
      logger.info("Raw response preview:")
      // Show first 500 chars to help debug
      console.log(text.substring(0, 500) + (text.length > 500 ? "\n..." : ""))
    }

    return {
      content: summary,
      files,
      followUp: undefined,
      tokensUsed: undefined,
    }
  }

  private extractFilesFromCodeBlocks(text: string): GeneratedFile[] {
    const files: GeneratedFile[] = []

    // Match all code blocks: ```lang\n...content...\n```
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
    let match

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const lang = match[1] || ""
      const blockContent = match[2]

      // Try to extract filepath from first line of the code block
      const lines = blockContent.split("\n")
      let filePath: string | null = null
      let contentStartIndex = 0

      // Check common filepath comment patterns
      for (let i = 0; i < Math.min(3, lines.length); i++) {
        const line = lines[i].trim()
        const pathMatch =
          // // filepath: path/to/file.ext
          line.match(/^\/\/\s*filepath:\s*(.+)/) ||
          // # filepath: path/to/file.py
          line.match(/^#\s*filepath:\s*(.+)/) ||
          // <!-- filepath: path/to/file.html -->
          line.match(/<!--\s*filepath:\s*(.+?)\s*-->/) ||
          // /* filepath: path/to/file.css */
          line.match(/\/\*\s*filepath:\s*(.+?)\s*\*\//) ||
          // // File: path/to/file.ext
          line.match(/^\/\/\s*[Ff]ile:\s*(.+)/) ||
          // # File: path/to/file.py
          line.match(/^#\s*[Ff]ile:\s*(.+)/) ||
          // // path/to/file.ext
          line.match(/^\/\/\s*([\w./-]+\.\w+)\s*$/) ||
          // # path/to/file.py
          line.match(/^#\s*([\w./-]+\.\w+)\s*$/)

        if (pathMatch) {
          filePath = pathMatch[1].trim()
          contentStartIndex = i + 1
          break
        }
      }

      // Also check text BEFORE the code block for a file path reference
      if (!filePath) {
        const beforeBlock = text.substring(0, match.index)
        const lastLines = beforeBlock.trim().split("\n").slice(-3)
        for (const line of lastLines.reverse()) {
          const refMatch =
            // **`src/routes/todos.ts`**
            line.match(/\*\*`([^`]+\.\w+)`\*\*/) ||
            // `src/routes/todos.ts`
            line.match(/`([^`]+\.\w+)`/) ||
            // ### src/routes/todos.ts
            line.match(/^#+\s*([\w./-]+\.\w+)/) ||
            // src/routes/todos.ts:
            line.match(/^([\w./-]+\.\w+)\s*:?\s*$/)

          if (refMatch) {
            filePath = refMatch[1].trim()
            break
          }
        }
      }

      if (filePath) {
        // Clean the path
        filePath = filePath.replace(/^[`'"]+|[`'"]+$/g, "").trim()

        const fileContent = lines.slice(contentStartIndex).join("\n").trimEnd()

        files.push({
          path: filePath,
          content: fileContent,
          language: lang || this.inferLanguage(filePath),
          description: undefined,
        })
      }
    }

    return files
  }

  private inferLanguage(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() || ""
    const langMap: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
      kt: "kotlin", swift: "swift", cs: "csharp", cpp: "cpp", c: "c",
      html: "html", css: "css", scss: "scss", json: "json", yaml: "yaml",
      yml: "yaml", toml: "toml", md: "markdown", sql: "sql", sh: "bash",
      graphql: "graphql", gql: "graphql", prisma: "prisma", vue: "vue",
      svelte: "svelte", astro: "astro",
    }
    return langMap[ext] || ext
  }
}
