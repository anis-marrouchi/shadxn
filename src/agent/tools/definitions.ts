// --- Agent tool definitions in Anthropic tool_use format ---

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
  permission?: "file-read" | "file-write" | "command" | "none"
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "create_files",
    description:
      "Create one or more files as output. Use this when you need to generate code, documents, configs, or any file-based output.",
    input_schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Relative file path from project root (e.g., src/components/Button.tsx)",
              },
              content: {
                type: "string",
                description: "The full content of the file",
              },
              language: {
                type: "string",
                description: "Programming language or file type",
              },
              description: {
                type: "string",
                description: "Brief description of what this file does",
              },
            },
            required: ["path", "content"],
          },
        },
        summary: {
          type: "string",
          description: "Brief summary of all generated files",
        },
      },
      required: ["files"],
    },
    permission: "file-write",
  },
  {
    name: "ask_user",
    description:
      "Ask the user a clarifying question when you need more information to proceed. Use this when the request is ambiguous or you need to confirm important decisions.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of choices for the user",
        },
      },
      required: ["question"],
    },
    permission: "none",
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file. Use this to inspect existing code, understand patterns, check implementations, or gather context before generating code.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path from project root",
        },
        max_lines: {
          type: "number",
          description:
            "Maximum number of lines to read. Defaults to 500. Use for large files.",
        },
      },
      required: ["path"],
    },
    permission: "file-read",
  },
  {
    name: "search_files",
    description:
      "Search for files matching a pattern and optionally search their content with a regex. Use this to find relevant code, understand project structure, or locate specific patterns.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files (e.g., 'src/**/*.ts', '*.json')",
        },
        content_regex: {
          type: "string",
          description:
            "Optional regex to search within matched files. Returns matching lines.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return. Default: 50.",
        },
      },
      required: ["pattern"],
    },
    permission: "none",
  },
  {
    name: "list_directory",
    description:
      "List files and directories at a given path. Use this to explore project structure.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative directory path from project root. Defaults to '.' (root).",
        },
        recursive: {
          type: "boolean",
          description: "List recursively. Default: false.",
        },
        max_depth: {
          type: "number",
          description: "Maximum depth for recursive listing. Default: 3.",
        },
      },
    },
    permission: "none",
  },
  {
    name: "run_command",
    description:
      "Execute a shell command. Use this to run build tools, test commands, linters, or inspect the environment. Commands run in the project root directory.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description:
            "Timeout in milliseconds. Default: 30000 (30 seconds).",
        },
      },
      required: ["command"],
    },
    permission: "command",
  },
  {
    name: "edit_file",
    description:
      "Apply search-and-replace edits to an existing file. Use this for targeted modifications to existing code rather than rewriting entire files.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path from project root",
        },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              old_text: {
                type: "string",
                description: "The exact text to find in the file",
              },
              new_text: {
                type: "string",
                description: "The replacement text",
              },
            },
            required: ["old_text", "new_text"],
          },
          description: "List of search/replace pairs to apply in order",
        },
      },
      required: ["path", "edits"],
    },
    permission: "file-write",
  },
]

/**
 * Get all tool definitions in Anthropic API format (for generateRaw()).
 * Optionally filter by enabled tool names.
 */
export function getAnthropicTools(enabledTools?: string[]): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  const defs = enabledTools
    ? TOOL_DEFINITIONS.filter((t) => enabledTools.includes(t.name))
    : TOOL_DEFINITIONS

  return defs.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }))
}

/**
 * Get the legacy tools (create_files + ask_user) for backward compatibility.
 */
export function getLegacyTools(): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return getAnthropicTools(["create_files", "ask_user"])
}

/**
 * Format tool descriptions for inclusion in a system prompt.
 * Used when the `claude` CLI binary handles its own tools —
 * we describe our additional tools as text so the binary's built-in
 * capabilities (read, write, bash) handle them natively.
 */
export function formatToolsForSystemPrompt(): string {
  const agenticTools = TOOL_DEFINITIONS.filter(
    (t) => t.name !== "create_files" && t.name !== "ask_user"
  )

  if (agenticTools.length === 0) return ""

  const lines = [
    "# Available Capabilities",
    "In addition to generating files, you have the following capabilities:",
    "",
  ]

  for (const tool of agenticTools) {
    lines.push(`## ${tool.name}`)
    lines.push(tool.description)
    lines.push("")
  }

  return lines.join("\n")
}

export const ALL_TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name)
