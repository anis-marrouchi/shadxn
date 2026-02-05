import type { AgentContext } from "@/src/agent"
import type { Memory } from "./memory"

// --- Agent Pipeline: middleware chain like Laravel/Express ---
// Request → Auth → Context → Memory → Skills → Agent → Validate → Heal → Enhance → Response

export interface PipelineRequest {
  id: string
  task: string
  outputType?: string
  outputDir?: string
  provider?: string
  model?: string
  apiKey?: string
  cwd: string
  overwrite?: boolean
  metadata?: Record<string, unknown>
}

export interface PipelineResponse {
  id: string
  success: boolean
  files: { path: string; content?: string }[]
  content: string
  outputType: string
  error?: string
  healed?: boolean
  healAttempts?: number
  tokensUsed?: number
  memoryEntryId?: string
  insights?: string[]
  duration: number
}

export type MiddlewareFn = (
  req: PipelineRequest,
  res: PipelineResponse,
  context: PipelineContext,
  next: () => Promise<void>
) => Promise<void>

export interface PipelineContext {
  agentContext?: AgentContext
  memory?: Memory
  startTime: number
  [key: string]: unknown
}

export class Pipeline {
  private middleware: { name: string; fn: MiddlewareFn }[] = []

  use(name: string, fn: MiddlewareFn): Pipeline {
    this.middleware.push({ name, fn })
    return this
  }

  async execute(req: PipelineRequest): Promise<PipelineResponse> {
    const res: PipelineResponse = {
      id: req.id,
      success: false,
      files: [],
      content: "",
      outputType: req.outputType || "auto",
      duration: 0,
    }

    const context: PipelineContext = {
      startTime: Date.now(),
    }

    let index = 0

    const next = async (): Promise<void> => {
      if (index >= this.middleware.length) return
      const mw = this.middleware[index++]
      await mw.fn(req, res, context, next)
    }

    try {
      await next()
      res.duration = Date.now() - context.startTime
    } catch (error: any) {
      res.success = false
      res.error = error.message
      res.duration = Date.now() - context.startTime
    }

    return res
  }

  getMiddlewareNames(): string[] {
    return this.middleware.map((m) => m.name)
  }
}
