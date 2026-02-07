// --- A2A Protocol Server ---

import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { generate, generateStream } from "@/src/agent"
import type { ProviderName } from "@/src/agent/providers"
import type {
  AgentCard,
  Task,
  TaskState,
  TaskMessage,
  TaskArtifact,
  TaskStatusUpdate,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MessagePart,
} from "./types"
import { A2A_ERRORS } from "./types"

export interface A2AServerConfig {
  port: number
  host: string
  provider: ProviderName
  model?: string
  apiKey?: string
  cwd: string
  cors: boolean
}

const DEFAULT_CONFIG: A2AServerConfig = {
  port: 3171,
  host: "0.0.0.0",
  provider: "claude-code",
  cwd: process.cwd(),
  cors: true,
}

export class A2AServer {
  private config: A2AServerConfig
  private tasks: Map<string, Task> = new Map()
  private activeCancellations: Set<string> = new Set()
  private log: (...args: unknown[]) => void

  constructor(config?: Partial<A2AServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.log = console.error.bind(console, "[a2a]")
  }

  async start(): Promise<void> {
    const server = createServer(async (req, res) => {
      if (this.config.cors) {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if (req.method === "OPTIONS") {
          res.writeHead(204)
          res.end()
          return
        }
      }

      await this.handleRequest(req, res)
    })

    server.listen(this.config.port, this.config.host, () => {
      this.log(`\n  shadxn A2A server v0.1.0`)
      this.log(`  Listening on http://${this.config.host}:${this.config.port}`)
      this.log(`  Provider: ${this.config.provider}`)
      this.log(`  Working dir: ${this.config.cwd}`)
      this.log("")
      this.log("  Discovery:")
      this.log(`    GET  /.well-known/agent-card.json`)
      this.log("")
      this.log("  JSON-RPC 2.0 methods:")
      this.log("    tasks/send          — synchronous task execution")
      this.log("    tasks/sendSubscribe — streaming task execution (SSE)")
      this.log("    tasks/get           — retrieve task state")
      this.log("    tasks/cancel        — cancel running task")
      this.log("")
    })
  }

  private getAgentCard(): AgentCard {
    return {
      name: "shadxn",
      description:
        "AI-powered agentic code generation agent. Generates components, pages, APIs, documents, skills, and more for any tech stack.",
      url: `http://${this.config.host}:${this.config.port}`,
      version: "0.1.0",
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      skills: [
        {
          id: "generate",
          name: "Code Generation",
          description:
            "Generate code files from natural language descriptions. Supports components, pages, APIs, tests, schemas, and more.",
          tags: ["code-generation", "ai", "multi-framework"],
          examples: [
            "Create a React login form with email and password validation",
            "Generate a REST API for user management with CRUD operations",
            "Build a dashboard page with charts and data tables",
          ],
        },
        {
          id: "evolve",
          name: "Code Transformation",
          description:
            "Transform existing code files based on natural language instructions. Applies targeted edits with diff preview.",
          tags: ["code-transformation", "refactoring", "ai"],
          examples: [
            "Add dark mode support to this component",
            "Refactor this API to use async/await instead of callbacks",
          ],
        },
        {
          id: "inspect",
          name: "Project Analysis",
          description:
            "Analyze a project's tech stack, schemas, dependencies, and structure.",
          tags: ["analysis", "project-inspection"],
          examples: [
            "What tech stack does this project use?",
            "List all API schemas in the project",
          ],
        },
      ],
      defaultInputModes: ["text"],
      defaultOutputModes: ["text", "file"],
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const method = req.method || "GET"
    const pathname = url.pathname

    this.log(`${method} ${pathname}`)

    try {
      // Agent card discovery
      if (method === "GET" && pathname === "/.well-known/agent-card.json") {
        this.sendJson(res, 200, this.getAgentCard())
        return
      }

      // JSON-RPC 2.0 endpoint
      if (method === "POST" && pathname === "/") {
        const body = await readBody(req)
        await this.handleJsonRpc(body, res)
        return
      }

      this.sendJson(res, 404, {
        error: "Not found",
        hint: "Use GET /.well-known/agent-card.json for discovery or POST / for JSON-RPC",
      })
    } catch (error: any) {
      this.log("Error:", error.message)
      this.sendJson(res, 500, { error: error.message })
    }
  }

  private async handleJsonRpc(
    request: Record<string, unknown>,
    res: ServerResponse
  ): Promise<void> {
    // Validate JSON-RPC format
    if (request.jsonrpc !== "2.0" || !request.method || !request.id) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: (request.id as string | number) || 0,
        error: A2A_ERRORS.PARSE_ERROR,
      })
      return
    }

    const rpc = request as unknown as JsonRpcRequest
    const params = (rpc.params || {}) as Record<string, unknown>

    switch (rpc.method) {
      case "tasks/send":
        await this.handleTaskSend(rpc.id, params, res)
        break
      case "tasks/sendSubscribe":
        await this.handleTaskSendSubscribe(rpc.id, params, res)
        break
      case "tasks/get":
        this.handleTaskGet(rpc.id, params, res)
        break
      case "tasks/cancel":
        this.handleTaskCancel(rpc.id, params, res)
        break
      default:
        this.sendJsonRpc(res, {
          jsonrpc: "2.0",
          id: rpc.id,
          error: A2A_ERRORS.METHOD_NOT_FOUND,
        })
    }
  }

  private async handleTaskSend(
    rpcId: string | number,
    params: Record<string, unknown>,
    res: ServerResponse
  ): Promise<void> {
    const taskId = String(params.id || `task-${Date.now().toString(36)}`)
    const message = params.message as { role?: string; parts?: MessagePart[] } | undefined

    if (!message?.parts?.length) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: { ...A2A_ERRORS.INVALID_PARAMS, data: "message with parts is required" },
      })
      return
    }

    // Extract text from message parts
    const textParts = message.parts.filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>
    const taskText = textParts.map((p) => p.text).join("\n")

    if (!taskText) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: { ...A2A_ERRORS.INVALID_PARAMS, data: "No text content in message parts" },
      })
      return
    }

    // Create task
    const task: Task = {
      id: taskId,
      state: "submitted",
      messages: [{ role: "user", parts: message.parts as MessagePart[] }],
      artifacts: [],
      metadata: params.metadata as Record<string, unknown> | undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.tasks.set(taskId, task)

    // Execute generation
    task.state = "working"
    task.updatedAt = new Date().toISOString()

    try {
      const result = await generate({
        task: taskText,
        cwd: this.config.cwd,
        provider: this.config.provider,
        model: this.config.model,
        apiKey: this.config.apiKey,
        overwrite: true,
        interactive: false,
        context7: true,
      })

      // Build artifacts from generated files
      const artifacts: TaskArtifact[] = result.files.written.map((filePath, i) => ({
        name: filePath,
        description: `Generated file`,
        parts: [{ type: "text" as const, text: filePath }],
        index: i,
      }))

      // Add agent response message
      const agentMessage: TaskMessage = {
        role: "agent",
        parts: [{ type: "text", text: result.content || "Generation complete." }],
      }

      if (result.followUp) {
        task.state = "input-required"
        agentMessage.parts.push({
          type: "text",
          text: `\n\nQuestion: ${result.followUp}`,
        })
      } else {
        task.state = "completed"
      }

      task.messages.push(agentMessage)
      task.artifacts = artifacts
      task.updatedAt = new Date().toISOString()
    } catch (error: any) {
      task.state = "failed"
      task.messages.push({
        role: "agent",
        parts: [{ type: "text", text: `Error: ${error.message}` }],
      })
      task.updatedAt = new Date().toISOString()
    }

    this.sendJsonRpc(res, {
      jsonrpc: "2.0",
      id: rpcId,
      result: task,
    })
  }

  private async handleTaskSendSubscribe(
    rpcId: string | number,
    params: Record<string, unknown>,
    res: ServerResponse
  ): Promise<void> {
    const taskId = String(params.id || `task-${Date.now().toString(36)}`)
    const message = params.message as { role?: string; parts?: MessagePart[] } | undefined

    if (!message?.parts?.length) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: { ...A2A_ERRORS.INVALID_PARAMS, data: "message with parts is required" },
      })
      return
    }

    const textParts = message.parts.filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>
    const taskText = textParts.map((p) => p.text).join("\n")

    if (!taskText) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: { ...A2A_ERRORS.INVALID_PARAMS, data: "No text content in message parts" },
      })
      return
    }

    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    })

    // Create task
    const task: Task = {
      id: taskId,
      state: "submitted",
      messages: [{ role: "user", parts: message.parts as MessagePart[] }],
      artifacts: [],
      metadata: params.metadata as Record<string, unknown> | undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.tasks.set(taskId, task)

    const sendSSE = (update: TaskStatusUpdate) => {
      res.write(`data: ${JSON.stringify(update)}\n\n`)
    }

    // Send initial submitted event
    sendSSE({
      id: taskId,
      state: "submitted",
      final: false,
    })

    // Start working
    task.state = "working"
    task.updatedAt = new Date().toISOString()

    sendSSE({
      id: taskId,
      state: "working",
      final: false,
    })

    try {
      let textContent = ""
      const artifacts: TaskArtifact[] = []

      for await (const event of generateStream({
        task: taskText,
        cwd: this.config.cwd,
        provider: this.config.provider,
        model: this.config.model,
        apiKey: this.config.apiKey,
        overwrite: true,
        interactive: false,
        context7: true,
      })) {
        // Check cancellation
        if (this.activeCancellations.has(taskId)) {
          this.activeCancellations.delete(taskId)
          task.state = "canceled"
          task.updatedAt = new Date().toISOString()
          sendSSE({ id: taskId, state: "canceled", final: true })
          res.end()
          return
        }

        if (event.type === "text_delta") {
          textContent += event.text
          sendSSE({
            id: taskId,
            state: "working",
            message: {
              role: "agent",
              parts: [{ type: "text", text: event.text }],
            },
            final: false,
          })
        }

        if (event.type === "generate_result") {
          const result = event.result
          const fileArtifacts = result.files.written.map((filePath, i) => ({
            name: filePath,
            parts: [{ type: "text" as const, text: filePath }],
            index: i,
          }))
          artifacts.push(...fileArtifacts)

          for (const artifact of fileArtifacts) {
            sendSSE({
              id: taskId,
              state: "working",
              artifact,
              final: false,
            })
          }

          if (result.followUp) {
            task.state = "input-required"
          } else {
            task.state = "completed"
          }
        }
      }

      task.messages.push({
        role: "agent",
        parts: [{ type: "text", text: textContent || "Generation complete." }],
      })
      task.artifacts = artifacts
      task.updatedAt = new Date().toISOString()

      sendSSE({
        id: taskId,
        state: task.state,
        final: true,
      })
    } catch (error: any) {
      task.state = "failed"
      task.messages.push({
        role: "agent",
        parts: [{ type: "text", text: `Error: ${error.message}` }],
      })
      task.updatedAt = new Date().toISOString()

      sendSSE({
        id: taskId,
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: `Error: ${error.message}` }],
        },
        final: true,
      })
    }

    res.end()
  }

  private handleTaskGet(
    rpcId: string | number,
    params: Record<string, unknown>,
    res: ServerResponse
  ): void {
    const taskId = String(params.id || "")
    const task = this.tasks.get(taskId)

    if (!task) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: A2A_ERRORS.TASK_NOT_FOUND,
      })
      return
    }

    this.sendJsonRpc(res, {
      jsonrpc: "2.0",
      id: rpcId,
      result: task,
    })
  }

  private handleTaskCancel(
    rpcId: string | number,
    params: Record<string, unknown>,
    res: ServerResponse
  ): void {
    const taskId = String(params.id || "")
    const task = this.tasks.get(taskId)

    if (!task) {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: A2A_ERRORS.TASK_NOT_FOUND,
      })
      return
    }

    if (task.state !== "working" && task.state !== "submitted") {
      this.sendJsonRpc(res, {
        jsonrpc: "2.0",
        id: rpcId,
        error: A2A_ERRORS.TASK_NOT_CANCELABLE,
      })
      return
    }

    this.activeCancellations.add(taskId)
    task.state = "canceled"
    task.updatedAt = new Date().toISOString()

    this.sendJsonRpc(res, {
      jsonrpc: "2.0",
      id: rpcId,
      result: task,
    })
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(data, null, 2))
  }

  private sendJsonRpc(res: ServerResponse, response: JsonRpcResponse): void {
    if (!res.headersSent) {
      res.writeHead(200, { "Content-Type": "application/json" })
    }
    res.end(JSON.stringify(response))
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
    req.on("error", reject)
  })
}
