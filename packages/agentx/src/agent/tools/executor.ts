// --- Tool Executor: runs tool calls with permission and hook integration ---

import { promises as fs } from "fs"
import path from "path"
import { execa } from "execa"
import fg from "fast-glob"
import { globalPermissions } from "@/permissions"
import { globalHooks } from "@/hooks"
import { debug } from "@/observability"
import type { GeneratedFile } from "../providers/types"

export interface ToolCallInput {
  name: string
  id: string
  input: Record<string, unknown>
}

export interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
  /** Files collected from create_files calls */
  files?: GeneratedFile[]
  /** Question from ask_user calls */
  followUp?: string
}

export interface ToolExecutorOptions {
  interactive?: boolean
  overwrite?: boolean
  dryRun?: boolean
}

export class ToolExecutor {
  private cwd: string
  private options: ToolExecutorOptions

  constructor(cwd: string, options: ToolExecutorOptions = {}) {
    this.cwd = cwd
    this.options = options
  }

  async execute(call: ToolCallInput): Promise<ToolResult> {
    debug.context("tool-executor", `executing: ${call.name}`)

    // pre:tool-call hook
    if (globalHooks.has("pre:tool-call")) {
      const hookResult = await globalHooks.execute("pre:tool-call", {
        event: "pre:tool-call" as any,
        toolName: call.name,
        toolInput: call.input,
        cwd: this.cwd,
      })
      if (hookResult.blocked) {
        return {
          tool_use_id: call.id,
          content: hookResult.message || `Tool ${call.name} blocked by pre:tool-call hook`,
          is_error: true,
        }
      }
    }

    let result: ToolResult

    try {
      switch (call.name) {
        case "read_file":
          result = await this.readFile(call)
          break
        case "search_files":
          result = await this.searchFiles(call)
          break
        case "list_directory":
          result = await this.listDirectory(call)
          break
        case "run_command":
          result = await this.runCommand(call)
          break
        case "edit_file":
          result = await this.editFile(call)
          break
        case "create_files":
          result = await this.createFiles(call)
          break
        case "ask_user":
          result = await this.askUser(call)
          break
        default:
          result = {
            tool_use_id: call.id,
            content: `Unknown tool: ${call.name}`,
            is_error: true,
          }
      }
    } catch (error: any) {
      result = {
        tool_use_id: call.id,
        content: `Error executing ${call.name}: ${error.message}`,
        is_error: true,
      }
    }

    // post:tool-call hook
    if (globalHooks.has("post:tool-call")) {
      await globalHooks.execute("post:tool-call", {
        event: "post:tool-call" as any,
        toolName: call.name,
        toolInput: call.input,
        toolResult: result.content,
        cwd: this.cwd,
      })
    }

    return result
  }

  private async readFile(call: ToolCallInput): Promise<ToolResult> {
    const filePath = String(call.input.path || "")
    const maxLines = Number(call.input.max_lines) || 500
    const absPath = path.resolve(this.cwd, filePath)

    const content = await fs.readFile(absPath, "utf8")
    const lines = content.split("\n")
    const truncated = lines.length > maxLines
    const output = truncated
      ? lines.slice(0, maxLines).join("\n") + `\n\n... (truncated, ${lines.length - maxLines} more lines)`
      : content

    return {
      tool_use_id: call.id,
      content: output,
    }
  }

  private async searchFiles(call: ToolCallInput): Promise<ToolResult> {
    const pattern = String(call.input.pattern || "**/*")
    const contentRegex = call.input.content_regex ? String(call.input.content_regex) : undefined
    const maxResults = Number(call.input.max_results) || 50

    const files = await fg(pattern, {
      cwd: this.cwd,
      ignore: ["node_modules/**", ".git/**", "dist/**", ".next/**"],
      dot: false,
    })

    if (!contentRegex) {
      const limited = files.slice(0, maxResults)
      return {
        tool_use_id: call.id,
        content: limited.length
          ? limited.join("\n") + (files.length > maxResults ? `\n\n... (${files.length - maxResults} more files)` : "")
          : "No files matched the pattern.",
      }
    }

    // Search content within matched files
    const regex = new RegExp(contentRegex, "gm")
    const results: string[] = []

    for (const file of files) {
      if (results.length >= maxResults) break
      try {
        const content = await fs.readFile(path.resolve(this.cwd, file), "utf8")
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break
          if (regex.test(lines[i])) {
            results.push(`${file}:${i + 1}: ${lines[i]}`)
          }
          regex.lastIndex = 0
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      tool_use_id: call.id,
      content: results.length
        ? results.join("\n")
        : "No matches found.",
    }
  }

  private async listDirectory(call: ToolCallInput): Promise<ToolResult> {
    const dirPath = String(call.input.path || ".")
    const recursive = Boolean(call.input.recursive)
    const maxDepth = Number(call.input.max_depth) || 3
    const absPath = path.resolve(this.cwd, dirPath)

    if (recursive) {
      const pattern = "**/*"
      const entries = await fg(pattern, {
        cwd: absPath,
        onlyFiles: false,
        markDirectories: true,
        deep: maxDepth,
        ignore: ["node_modules/**", ".git/**", "dist/**", ".next/**"],
      })
      return {
        tool_use_id: call.id,
        content: entries.length ? entries.join("\n") : "Empty directory.",
      }
    }

    const entries = await fs.readdir(absPath, { withFileTypes: true })
    const formatted = entries.map((e) =>
      e.isDirectory() ? `${e.name}/` : e.name
    )

    return {
      tool_use_id: call.id,
      content: formatted.length ? formatted.join("\n") : "Empty directory.",
    }
  }

  private async runCommand(call: ToolCallInput): Promise<ToolResult> {
    const command = String(call.input.command || "")
    const timeout = Number(call.input.timeout) || 30_000

    // Check permissions
    const permission = await globalPermissions.checkCommand(command)
    if (permission === "deny") {
      return {
        tool_use_id: call.id,
        content: `Command blocked by permissions (mode: ${globalPermissions.getMode()}): ${command}`,
        is_error: true,
      }
    }

    // pre:command hook
    if (globalHooks.has("pre:command")) {
      const hookResult = await globalHooks.execute("pre:command", {
        event: "pre:command",
        command,
        cwd: this.cwd,
      })
      if (hookResult.blocked) {
        return {
          tool_use_id: call.id,
          content: hookResult.message || `Command blocked by pre:command hook: ${command}`,
          is_error: true,
        }
      }
    }

    const result = await execa("sh", ["-c", command], {
      cwd: this.cwd,
      timeout,
      reject: false,
      stdin: "ignore",
    })

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n")
    const truncated = output.length > 10_000
      ? output.slice(0, 10_000) + "\n\n... (output truncated)"
      : output

    if (result.exitCode !== 0) {
      return {
        tool_use_id: call.id,
        content: `Command exited with code ${result.exitCode}:\n${truncated}`,
        is_error: true,
      }
    }

    return {
      tool_use_id: call.id,
      content: truncated || "(no output)",
    }
  }

  private async editFile(call: ToolCallInput): Promise<ToolResult> {
    const filePath = String(call.input.path || "")
    const edits = call.input.edits as Array<{ old_text: string; new_text: string }> | undefined
    const absPath = path.resolve(this.cwd, filePath)

    if (!edits || edits.length === 0) {
      return {
        tool_use_id: call.id,
        content: "No edits provided.",
        is_error: true,
      }
    }

    // Check write permission
    const permission = await globalPermissions.checkFileWrite(filePath)
    if (permission === "deny") {
      return {
        tool_use_id: call.id,
        content: `File write blocked by permissions: ${filePath}`,
        is_error: true,
      }
    }
    if (permission === "skip") {
      return {
        tool_use_id: call.id,
        content: `File write skipped (plan mode): ${filePath}`,
      }
    }

    // pre:file-write hook
    if (globalHooks.has("pre:file-write")) {
      const hookResult = await globalHooks.execute("pre:file-write", {
        event: "pre:file-write",
        file: absPath,
        cwd: this.cwd,
      })
      if (hookResult.blocked) {
        return {
          tool_use_id: call.id,
          content: hookResult.message || `File edit blocked by pre:file-write hook: ${filePath}`,
          is_error: true,
        }
      }
    }

    let content = await fs.readFile(absPath, "utf8")
    const applied: string[] = []

    for (const edit of edits) {
      if (content.includes(edit.old_text)) {
        content = content.replace(edit.old_text, edit.new_text)
        applied.push(`Replaced: "${edit.old_text.slice(0, 40)}..."`)
      } else {
        applied.push(`Not found: "${edit.old_text.slice(0, 40)}..."`)
      }
    }

    if (!this.options.dryRun) {
      await fs.writeFile(absPath, content, "utf8")
    }

    // post:file-write hook
    if (globalHooks.has("post:file-write")) {
      await globalHooks.execute("post:file-write", {
        event: "post:file-write",
        file: absPath,
        fileContent: content,
        cwd: this.cwd,
      })
    }

    return {
      tool_use_id: call.id,
      content: `Edited ${filePath}:\n${applied.join("\n")}`,
    }
  }

  private async createFiles(call: ToolCallInput): Promise<ToolResult> {
    const input = call.input as {
      files?: GeneratedFile[]
      summary?: string
    }

    const files = input.files || []

    return {
      tool_use_id: call.id,
      content: input.summary || `Queued ${files.length} file(s) for creation.`,
      files,
    }
  }

  private async askUser(call: ToolCallInput): Promise<ToolResult> {
    const question = String(call.input.question || "")
    const options = call.input.options as string[] | undefined

    let followUp = question
    if (options?.length) {
      followUp += `\nOptions: ${options.join(", ")}`
    }

    return {
      tool_use_id: call.id,
      content: "Question sent to user.",
      followUp,
    }
  }
}
