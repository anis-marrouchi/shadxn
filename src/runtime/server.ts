import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { createAgentContext, generate } from "@/src/agent"
import type { ProviderName } from "@/src/agent/providers"
import { Memory } from "./memory"
import { HealEngine } from "./heal"
import { EnhanceEngine } from "./enhance"
import { Pipeline, type PipelineRequest, type PipelineResponse, type MiddlewareFn } from "./pipeline"
import { detectTechStack, formatTechStack } from "@/src/agent/context/tech-stack"

// --- Runtime Server: HTTP server that receives requests and sends responses ---
// Like Laravel, but every request is powered by AI agents.
// The server learns, heals, and enhances itself over time.

export interface RuntimeConfig {
  port: number
  host: string
  provider: ProviderName
  model?: string
  apiKey?: string
  cwd: string
  memory: { enabled: boolean }
  heal: {
    enabled: boolean
    testCommand?: string
    buildCommand?: string
  }
  enhance: { enabled: boolean; autoSkills: boolean }
  cors: boolean
}

const DEFAULT_CONFIG: RuntimeConfig = {
  port: 3170,
  host: "0.0.0.0",
  provider: "claude",
  cwd: process.cwd(),
  memory: { enabled: true },
  heal: { enabled: true },
  enhance: { enabled: true, autoSkills: true },
  cors: true,
}

export class ShadxnRuntime {
  private config: RuntimeConfig
  private memory: Memory
  private healEngine: HealEngine
  private enhanceEngine: EnhanceEngine
  private pipeline: Pipeline
  private requestCount = 0
  private log: (...args: unknown[]) => void

  constructor(config?: Partial<RuntimeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.memory = new Memory(this.config.cwd)
    this.healEngine = new HealEngine(this.config.cwd, {
      enabled: this.config.heal.enabled,
      testCommand: this.config.heal.testCommand,
      buildCommand: this.config.heal.buildCommand,
      provider: this.config.provider,
      model: this.config.model,
      apiKey: this.config.apiKey,
    })
    this.enhanceEngine = new EnhanceEngine(this.config.cwd, this.memory, {
      enabled: this.config.enhance.enabled,
      autoSkills: this.config.enhance.autoSkills,
      provider: this.config.provider,
      model: this.config.model,
      apiKey: this.config.apiKey,
    })
    this.pipeline = this.buildPipeline()
    this.log = console.error.bind(console, "[shadxn]")
  }

  private buildPipeline(): Pipeline {
    const pipeline = new Pipeline()

    // 1. Memory loading
    pipeline.use("memory", this.memoryMiddleware())

    // 2. Context gathering
    pipeline.use("context", this.contextMiddleware())

    // 3. Generation
    pipeline.use("generate", this.generateMiddleware())

    // 4. Auto-heal
    pipeline.use("heal", this.healMiddleware())

    // 5. Memory recording
    pipeline.use("record", this.recordMiddleware())

    // 6. Enhancement check
    pipeline.use("enhance", this.enhanceMiddleware())

    return pipeline
  }

  async start(): Promise<void> {
    await this.memory.load()

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
      this.log(`\n  shadxn runtime v0.1.0`)
      this.log(`  Listening on http://${this.config.host}:${this.config.port}`)
      this.log(`  Provider: ${this.config.provider}`)
      this.log(`  Memory: ${this.config.memory.enabled ? "enabled" : "disabled"}`)
      this.log(`  Auto-heal: ${this.config.heal.enabled ? "enabled" : "disabled"}`)
      this.log(`  Self-enhance: ${this.config.enhance.enabled ? "enabled" : "disabled"}`)
      this.log(`  Pipeline: ${this.pipeline.getMiddlewareNames().join(" → ")}`)
      this.log(`  Working dir: ${this.config.cwd}`)
      this.log("")
      this.log("  Endpoints:")
      this.log("    POST /generate    — generate code/content")
      this.log("    POST /evolve      — transform existing code")
      this.log("    GET  /inspect     — project analysis")
      this.log("    GET  /memory      — view learning history")
      this.log("    POST /feedback    — provide feedback on a generation")
      this.log("    GET  /health      — health check")
      this.log("    POST /enhance     — trigger self-enhancement")
      this.log("")
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const method = req.method || "GET"
    const pathname = url.pathname

    this.log(`${method} ${pathname}`)

    try {
      switch (`${method} ${pathname}`) {
        case "POST /generate":
          await this.handleGenerate(req, res)
          break
        case "POST /evolve":
          await this.handleEvolve(req, res)
          break
        case "GET /inspect":
          await this.handleInspect(res)
          break
        case "GET /memory":
          await this.handleMemory(res)
          break
        case "POST /feedback":
          await this.handleFeedback(req, res)
          break
        case "GET /health":
          this.sendJson(res, 200, {
            status: "ok",
            uptime: process.uptime(),
            requests: this.requestCount,
            stats: this.memory.getStats(),
            pipeline: this.pipeline.getMiddlewareNames(),
          })
          break
        case "POST /enhance":
          await this.handleEnhance(res)
          break
        default:
          this.sendJson(res, 404, {
            error: "Not found",
            endpoints: [
              "POST /generate",
              "POST /evolve",
              "GET /inspect",
              "GET /memory",
              "POST /feedback",
              "GET /health",
              "POST /enhance",
            ],
          })
      }
    } catch (error: any) {
      this.log("Error:", error.message)
      this.sendJson(res, 500, { error: error.message })
    }

    this.requestCount++
  }

  private async handleGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    if (!body.task) {
      this.sendJson(res, 400, { error: "Missing required field: task" })
      return
    }

    const pipelineReq: PipelineRequest = {
      id: `req-${Date.now().toString(36)}`,
      task: body.task,
      outputType: body.type || body.outputType || "auto",
      outputDir: body.outputDir || body.output_dir,
      provider: body.provider || this.config.provider,
      model: body.model || this.config.model,
      apiKey: body.apiKey || body.api_key || this.config.apiKey,
      cwd: this.config.cwd,
      overwrite: body.overwrite ?? true,
      metadata: body.metadata,
    }

    const result = await this.pipeline.execute(pipelineReq)
    this.sendJson(res, result.success ? 200 : 500, result)
  }

  private async handleEvolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    if (!body.task || !body.glob) {
      this.sendJson(res, 400, {
        error: "Missing required fields: task, glob",
      })
      return
    }

    // Evolve uses the same pipeline but with file reading
    this.sendJson(res, 200, {
      message: "Use the CLI for evolve: shadxn evolve \"" + body.task + "\" --glob \"" + body.glob + "\"",
      hint: "The evolve endpoint requires interactive diff review. Use the CLI for full functionality.",
    })
  }

  private async handleInspect(res: ServerResponse): Promise<void> {
    const context = await createAgentContext(this.config.cwd, "inspect", {
      context7: { enabled: false },
    })

    this.sendJson(res, 200, {
      techStack: {
        languages: context.techStack.languages,
        frameworks: context.techStack.frameworks,
        packageManager: context.techStack.packageManager,
        databases: context.techStack.databases,
        styling: context.techStack.styling,
        testing: context.techStack.testing,
        deployment: context.techStack.deployment,
        monorepo: context.techStack.monorepo,
      },
      schemas: {
        database: context.schemas.database
          ? { type: context.schemas.database.type, tables: context.schemas.database.tables }
          : null,
        api: context.schemas.api ? { type: context.schemas.api.type } : null,
        env: context.schemas.env,
        models: context.schemas.models?.map((m) => ({ path: m.path, type: m.type })),
      },
      skills: context.skills.map((s) => ({
        name: s.frontmatter.name,
        description: s.frontmatter.description,
        source: s.source,
        tags: s.frontmatter.tags,
      })),
      dependencies: Object.keys(context.techStack.dependencies).length,
      devDependencies: Object.keys(context.techStack.devDependencies).length,
    })
  }

  private async handleMemory(res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      stats: this.memory.getStats(),
      recent: this.memory.getRecentGenerations(10),
      patterns: this.memory.getPatterns().slice(0, 10),
      preferences: this.memory.getPreferences(),
    })
  }

  private async handleFeedback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    if (!body.entryId || !body.feedback) {
      this.sendJson(res, 400, {
        error: "Missing required fields: entryId, feedback (positive/negative/neutral)",
      })
      return
    }

    await this.memory.recordFeedback(body.entryId, body.feedback)
    this.sendJson(res, 200, { recorded: true })
  }

  private async handleEnhance(res: ServerResponse): Promise<void> {
    const result = await this.enhanceEngine.enhance()
    this.sendJson(res, 200, result)
  }

  // --- Middleware factories ---

  private memoryMiddleware(): MiddlewareFn {
    const memory = this.memory
    return async (req, res, ctx, next) => {
      ctx.memory = memory
      const memoryContext = memory.buildMemoryContext(req.task)
      if (memoryContext) {
        ctx.memoryContext = memoryContext
      }
      await next()
    }
  }

  private contextMiddleware(): MiddlewareFn {
    return async (req, res, ctx, next) => {
      ctx.agentContext = await createAgentContext(req.cwd, req.task, {
        provider: req.provider as any,
        context7: { enabled: true },
      })
      await next()
    }
  }

  private generateMiddleware(): MiddlewareFn {
    return async (req, res, ctx, next) => {
      const result = await generate({
        task: ctx.memoryContext
          ? `${req.task}\n\n${ctx.memoryContext}`
          : req.task,
        outputType: req.outputType as any,
        outputDir: req.outputDir,
        overwrite: req.overwrite ?? true,
        cwd: req.cwd,
        provider: (req.provider || this.config.provider) as any,
        model: req.model || this.config.model,
        apiKey: req.apiKey || this.config.apiKey,
        context7: true,
        interactive: false,
        maxSteps: 5,
      })

      res.success = result.files.errors.length === 0
      res.files = result.files.written.map((f) => ({ path: f }))
      res.content = result.content
      res.outputType = result.outputType
      res.tokensUsed = result.tokensUsed

      await next()
    }
  }

  private healMiddleware(): MiddlewareFn {
    const healEngine = this.healEngine
    return async (req, res, ctx, next) => {
      if (this.config.heal.enabled && res.files.length > 0) {
        const healResult = await healEngine.detectAndHeal(
          res.files.map((f) => f.path),
          req.task,
          res.memoryEntryId
        )
        if (healResult.attempts > 0) {
          res.healed = healResult.healed
          res.healAttempts = healResult.attempts
          if (healResult.healed) {
            res.success = true
          }
        }
      }
      await next()
    }
  }

  private recordMiddleware(): MiddlewareFn {
    const memory = this.memory
    return async (req, res, ctx, next) => {
      if (this.config.memory.enabled) {
        const entryId = await memory.recordGeneration({
          task: req.task,
          outputType: res.outputType,
          files: res.files.map((f) => f.path),
          success: res.success,
          error: res.error,
          context: {
            techStack: ctx.agentContext?.techStack.languages.map((l) => l.name),
            frameworks: ctx.agentContext?.techStack.frameworks.map((f) => f.name),
          },
        })
        res.memoryEntryId = entryId

        // Learn preferences from request patterns
        if (req.outputType && req.outputType !== "auto") {
          await memory.learnPreference(
            "preferred-output-type",
            req.outputType,
            `generation request: ${req.task.slice(0, 50)}`
          )
        }
      }
      await next()
    }
  }

  private enhanceMiddleware(): MiddlewareFn {
    const enhanceEngine = this.enhanceEngine
    return async (req, res, ctx, next) => {
      // Run enhancement in background every 10 requests
      if (this.config.enhance.enabled && this.requestCount % 10 === 0 && this.requestCount > 0) {
        enhanceEngine.enhance().then((result) => {
          if (result.skillsCreated.length) {
            this.log(`Auto-created ${result.skillsCreated.length} skill(s): ${result.skillsCreated.join(", ")}`)
          }
          if (result.insights.length) {
            for (const insight of result.insights) {
              this.log(`Insight: ${insight}`)
            }
          }
        }).catch(() => {})
      }
      await next()
    }
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(data, null, 2))
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
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
