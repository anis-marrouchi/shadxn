import { createAgentContext } from "@/src/agent"
import { detectTechStack, formatTechStack } from "@/src/agent/context/tech-stack"
import { detectSchemas, formatSchemas } from "@/src/agent/context/schema"
import { loadLocalSkills, matchSkillsToTask } from "@/src/agent/skills/loader"
import { resolveOutputType } from "@/src/agent/outputs/types"
import { generate } from "@/src/agent"
import type { OutputType } from "@/src/agent/providers/types"

// --- MCP Server: expose shadxn as a Model Context Protocol server ---
// This allows Claude Code, Cursor, Windsurf, and any MCP client to use
// shadxn's capabilities as tools.

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: Record<string, unknown>
}

// MCP protocol constants
const SERVER_INFO = {
  name: "shadxn",
  version: "0.1.0",
}

const PROTOCOL_VERSION = "2024-11-05"

const CAPABILITIES = {
  tools: {},
}

// Tool definitions
const TOOLS = [
  {
    name: "shadxn_generate",
    description:
      "Generate code, components, pages, APIs, documents, tests, workflows, schemas, emails, diagrams, and more using AI. Understands the project's tech stack, schemas, and skills automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description:
            "Describe what to generate (e.g., 'a responsive pricing card', 'REST API for users', 'GitHub Actions CI pipeline')",
        },
        type: {
          type: "string",
          description:
            "Output type: component, page, api, website, document, script, config, skill, media, report, test, workflow, schema, email, diagram, auto",
          default: "auto",
        },
        output_dir: {
          type: "string",
          description: "Optional output directory (relative to project root)",
        },
        cwd: {
          type: "string",
          description: "Project working directory (defaults to current directory)",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "shadxn_inspect",
    description:
      "Analyze a project and return its tech stack, frameworks, databases, schemas, installed skills, and dependencies. Use this to understand a project before generating code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cwd: {
          type: "string",
          description: "Project working directory (defaults to current directory)",
        },
      },
    },
  },
  {
    name: "shadxn_skill_match",
    description:
      "Find installed skills that are relevant to a given task description. Returns matched skills with relevance scores.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "The task to match skills against",
        },
        cwd: {
          type: "string",
          description: "Project working directory",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "shadxn_detect_output_type",
    description:
      "Auto-detect the best output type for a given task description based on keyword analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "The task description to analyze",
        },
      },
      required: ["task"],
    },
  },
]

// Tool handlers
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: string; text: string }[] }> {
  const cwd = (args.cwd as string) || process.cwd()

  switch (name) {
    case "shadxn_generate": {
      const task = args.task as string
      const outputType = (args.type as string) || "auto"
      const outputDir = args.output_dir as string | undefined

      const result = await generate({
        task,
        outputType: outputType as OutputType,
        outputDir,
        cwd,
        overwrite: true,
        dryRun: false,
        context7: true,
        interactive: false,
        maxSteps: 5,
      })

      const summary: string[] = []
      if (result.content) summary.push(result.content)
      if (result.files.written.length) {
        summary.push(
          `\nCreated ${result.files.written.length} file(s):\n${result.files.written.map((f) => `  - ${f}`).join("\n")}`
        )
      }
      if (result.files.skipped.length) {
        summary.push(
          `\nSkipped ${result.files.skipped.length} existing file(s):\n${result.files.skipped.map((f) => `  - ${f}`).join("\n")}`
        )
      }
      if (result.followUp) {
        summary.push(`\nNeeds clarification: ${result.followUp}`)
      }

      return {
        content: [{ type: "text", text: summary.join("\n") || "Generation complete." }],
      }
    }

    case "shadxn_inspect": {
      const context = await createAgentContext(cwd, "inspect", {
        context7: { enabled: false },
      })

      const info: Record<string, unknown> = {
        languages: context.techStack.languages,
        frameworks: context.techStack.frameworks,
        packageManager: context.techStack.packageManager,
        databases: context.techStack.databases,
        styling: context.techStack.styling,
        testing: context.techStack.testing,
        deployment: context.techStack.deployment,
        monorepo: context.techStack.monorepo,
        srcDir: context.techStack.srcDir,
        dependencyCount: Object.keys(context.techStack.dependencies).length,
        devDependencyCount: Object.keys(context.techStack.devDependencies).length,
        schemas: {
          database: context.schemas.database
            ? {
                type: context.schemas.database.type,
                tables: context.schemas.database.tables,
              }
            : null,
          api: context.schemas.api ? { type: context.schemas.api.type } : null,
          env: context.schemas.env
            ? { variableCount: context.schemas.env.variables.length }
            : null,
          models: context.schemas.models?.map((m) => m.path) || [],
        },
        skills: context.skills.map((s) => ({
          name: s.frontmatter.name,
          description: s.frontmatter.description,
          source: s.source,
        })),
      }

      return {
        content: [
          {
            type: "text",
            text: `Project analysis:\n\n${formatTechStack(context.techStack)}\n\n${JSON.stringify(info, null, 2)}`,
          },
        ],
      }
    }

    case "shadxn_skill_match": {
      const task = args.task as string
      const skills = await loadLocalSkills(cwd)
      const matches = matchSkillsToTask(skills, task)

      if (!matches.length) {
        return {
          content: [
            {
              type: "text",
              text: "No matching skills found. Install skills with: shadxn skill install <owner/repo>",
            },
          ],
        }
      }

      const text = matches
        .map(
          (m) =>
            `- **${m.skill.frontmatter.name}** (relevance: ${(m.relevance * 100).toFixed(0)}%)\n  ${m.skill.frontmatter.description}\n  Match: ${m.matchReason}`
        )
        .join("\n\n")

      return {
        content: [{ type: "text", text: `Matching skills:\n\n${text}` }],
      }
    }

    case "shadxn_detect_output_type": {
      const task = args.task as string
      const type = resolveOutputType(undefined, task)
      return {
        content: [
          {
            type: "text",
            text: `Detected output type: ${type}`,
          },
        ],
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// --- Stdio transport ---

export async function startMcpServer(): Promise<void> {
  // Use stderr for logging (stdout is reserved for JSON-RPC)
  const log = (...args: unknown[]) => console.error("[shadxn-mcp]", ...args)

  log("Starting MCP server (stdio transport)...")

  let buffer = ""

  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk

    // Process complete messages (Content-Length header based)
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) break

      const header = buffer.slice(0, headerEnd)
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/)
      if (!contentLengthMatch) {
        // Try without header (some clients send raw JSON)
        const newlineIdx = buffer.indexOf("\n")
        if (newlineIdx === -1) break

        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)

        if (line) {
          try {
            const msg = JSON.parse(line)
            handleMessage(msg, log).catch((e) => log("Error:", e))
          } catch {
            // Not valid JSON, skip
          }
        }
        continue
      }

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + contentLength

      if (buffer.length < bodyEnd) break // Need more data

      const body = buffer.slice(bodyStart, bodyEnd)
      buffer = buffer.slice(bodyEnd)

      try {
        const msg = JSON.parse(body)
        handleMessage(msg, log).catch((e) => log("Error:", e))
      } catch (e) {
        log("Failed to parse message:", e)
      }
    }
  })

  process.stdin.on("end", () => {
    log("stdin closed, shutting down.")
    process.exit(0)
  })
}

function send(message: JsonRpcResponse | JsonRpcNotification): void {
  const body = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
  process.stdout.write(header + body)
}

async function handleMessage(
  msg: JsonRpcRequest,
  log: (...args: unknown[]) => void
): Promise<void> {
  const { method, id, params } = msg

  log(`Received: ${method}`)

  switch (method) {
    case "initialize": {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
        },
      })
      break
    }

    case "notifications/initialized": {
      log("Client initialized.")
      break
    }

    case "tools/list": {
      send({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      })
      break
    }

    case "tools/call": {
      const toolName = (params as any)?.name as string
      const toolArgs = ((params as any)?.arguments || {}) as Record<string, unknown>

      try {
        const result = await handleToolCall(toolName, toolArgs)
        send({
          jsonrpc: "2.0",
          id,
          result,
        })
      } catch (error: any) {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          },
        })
      }
      break
    }

    case "ping": {
      send({ jsonrpc: "2.0", id, result: {} })
      break
    }

    default: {
      if (id !== undefined) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
      }
    }
  }
}
