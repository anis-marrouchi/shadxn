// --- Usage tracking: tokens, cost, per-step and per-model breakdown ---

export interface StepUsage {
  step: number
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  timestamp: number
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cost: number
  steps: number
}

export interface UsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCost: number
  steps: StepUsage[]
  models: Record<string, ModelUsage>
}

// Cost per million tokens (input / output)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet": { input: 3, output: 15 },
  "claude-opus": { input: 15, output: 75 },
  "claude-haiku": { input: 0.25, output: 1.25 },
}

function getModelFamily(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes("opus")) return "claude-opus"
  if (lower.includes("haiku")) return "claude-haiku"
  return "claude-sonnet" // default
}

export class UsageTracker {
  private steps: StepUsage[] = []
  private models: Map<string, ModelUsage> = new Map()

  recordStep(
    step: number,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    const family = getModelFamily(model)
    const pricing = MODEL_PRICING[family] || MODEL_PRICING["claude-sonnet"]
    const cost =
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output

    this.steps.push({
      step,
      model,
      inputTokens,
      outputTokens,
      cost,
      timestamp: Date.now(),
    })

    const existing = this.models.get(model) || {
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      steps: 0,
    }
    existing.inputTokens += inputTokens
    existing.outputTokens += outputTokens
    existing.cost += cost
    existing.steps++
    this.models.set(model, existing)
  }

  getSummary(): UsageSummary {
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCost = 0

    for (const step of this.steps) {
      totalInputTokens += step.inputTokens
      totalOutputTokens += step.outputTokens
      totalCost += step.cost
    }

    const models: Record<string, ModelUsage> = {}
    for (const [name, usage] of this.models) {
      models[name] = { ...usage }
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost,
      steps: [...this.steps],
      models,
    }
  }

  reset(): void {
    this.steps = []
    this.models.clear()
  }
}

export const globalTracker = new UsageTracker()
