// --- Debug mode: timestamped verbose logging ---

import chalk from "chalk"

let debugEnabled = false

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled
}

export function isDebug(): boolean {
  return debugEnabled
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
}

export const debug = {
  log(...args: unknown[]): void {
    if (!debugEnabled) return
    console.log(chalk.dim(`[${timestamp()}]`), ...args)
  },

  step(step: number, message: string): void {
    if (!debugEnabled) return
    console.log(chalk.dim(`[${timestamp()}]`), chalk.blue(`[step ${step}]`), message)
  },

  hook(name: string, duration: number, result: string): void {
    if (!debugEnabled) return
    console.log(
      chalk.dim(`[${timestamp()}]`),
      chalk.magenta(`[hook]`),
      `${name} (${duration}ms) → ${result}`
    )
  },

  api(method: string, model: string, tokens?: number): void {
    if (!debugEnabled) return
    const tokenStr = tokens ? ` (${tokens} tokens)` : ""
    console.log(
      chalk.dim(`[${timestamp()}]`),
      chalk.yellow(`[api]`),
      `${method} → ${model}${tokenStr}`
    )
  },

  tokens(input: number, output: number, cost: number): void {
    if (!debugEnabled) return
    console.log(
      chalk.dim(`[${timestamp()}]`),
      chalk.green(`[tokens]`),
      `in: ${input.toLocaleString()}, out: ${output.toLocaleString()}, cost: $${cost.toFixed(4)}`
    )
  },

  context(label: string, detail: string): void {
    if (!debugEnabled) return
    console.log(chalk.dim(`[${timestamp()}]`), chalk.cyan(`[${label}]`), detail)
  },
}
