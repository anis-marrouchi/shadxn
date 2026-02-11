import chalk from "chalk"

import type { GenerateStreamEvent } from "@/agent"

function nowMs(): number {
  return Date.now()
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const ss = String(s % 60).padStart(2, "0")
  const mm = String(m % 60).padStart(2, "0")
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${m}:${ss}`
}

function tailLines(text: string, maxLines: number): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines.length <= maxLines) return lines
  return lines.slice(lines.length - maxLines)
}

function clampTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

export interface GenerateTuiOptions {
  task: string
  provider: string
  model?: string
  cwd: string
  outputDir?: string
  outputType?: string
  maxSteps?: number
  overwrite?: boolean
  dryRun?: boolean
}

export class GenerateTui {
  private startedAt = nowMs()
  private phase: string = "Analyzing project"
  private outputType: string = "auto"
  private iteration: number = 0
  private maxSteps?: number
  private filesCreated: number = 0
  private filesWritten: number = 0
  private filesSkipped: number = 0
  private filesErrors: number = 0

  private eventLog: string[] = []
  private textTail: string = ""
  private lastActivityAt = nowMs()

  private dirty = true
  private renderTimer: NodeJS.Timeout | undefined
  private pulseTimer: NodeJS.Timeout | undefined
  private stopped = false
  private restoreHandlersInstalled = false
  private handleExit = () => this.stop()
  private handleSigint = () => {
    this.stop()
    process.exit(130)
  }
  private handleSigterm = () => {
    this.stop()
    process.exit(143)
  }

  constructor(private opts: GenerateTuiOptions) {
    this.outputType = opts.outputType || "auto"
    this.maxSteps = opts.maxSteps
  }

  start(): void {
    if (!process.stdout.isTTY) return

    // Hide cursor.
    process.stdout.write("\x1b[?25l")
    this.installRestoreHandlers()
    // Keep the UI alive even if the provider doesn't stream (loader/elapsed updates).
    this.pulseTimer = setInterval(() => {
      if (this.stopped) return
      this.scheduleRender()
    }, 120)
    this.render()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true

    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.renderTimer = undefined
    if (this.pulseTimer) clearInterval(this.pulseTimer)
    this.pulseTimer = undefined

    if (process.stdout.isTTY) {
      // Show cursor.
      process.stdout.write("\x1b[?25h")
      // Leave screen in a clean state for normal logs.
      process.stdout.write("\n")
    }

    this.uninstallRestoreHandlers()
  }

  onEvent(evt: GenerateStreamEvent): void {
    if (this.stopped) return
    this.lastActivityAt = nowMs()

    if (evt.type === "context_ready") {
      this.phase = "Generating"
      this.outputType = evt.outputType
      this.log(`Context ready. Output type: ${evt.outputType}`)
    } else if (evt.type === "iteration") {
      this.phase = "Generating"
      this.iteration = evt.iteration
      this.log(`Step ${evt.iteration}${this.maxSteps ? `/${this.maxSteps}` : ""}`)
    } else if (evt.type === "tool_call") {
      this.phase = "Running tools"
      this.log(`Tool: ${evt.name} (${evt.id})`)
    } else if (evt.type === "tool_result") {
      const status = evt.is_error ? chalk.red("error") : chalk.green("ok")
      this.log(`Tool result: ${evt.name} (${evt.id}) ${status}`)
    } else if (evt.type === "step_complete") {
      this.filesCreated += evt.filesCount
      this.log(`Created ${evt.filesCount} file(s)`)
    } else if (evt.type === "text_delta") {
      // Keep a small tail; rendering is throttled.
      this.textTail = clampTail(this.textTail + evt.text, 4000)
    } else if (evt.type === "done") {
      this.phase = "Writing files"
      this.log("Model completed. Writing files...")
    } else if (evt.type === "generate_result") {
      this.phase = "Done"
      this.filesWritten = evt.result.files.written.length
      this.filesSkipped = evt.result.files.skipped.length
      this.filesErrors = evt.result.files.errors.length
      if (evt.result.healResult) {
        this.log(evt.result.healResult.healed ? "Verification: ok" : "Verification: failed")
      }
      if (evt.result.followUp) {
        this.phase = "Needs input"
        this.log("Waiting for your answer...")
      }
    } else if (evt.type === "error") {
      this.phase = "Error"
      this.log(chalk.red(evt.error))
    }

    this.scheduleRender()
  }

  private log(line: string): void {
    const ts = formatDuration(nowMs() - this.startedAt)
    const msg = `${chalk.dim(ts)} ${line}`
    this.eventLog.push(msg)
    if (this.eventLog.length > 25) {
      this.eventLog = this.eventLog.slice(this.eventLog.length - 25)
    }
  }

  private scheduleRender(): void {
    if (!process.stdout.isTTY) return
    this.dirty = true
    if (this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined
      this.render()
    }, 50)
  }

  private render(): void {
    if (!process.stdout.isTTY) return
    if (!this.dirty) return
    this.dirty = false

    const cols = process.stdout.columns || 80
    const rows = process.stdout.rows || 24
    const spinnerFrames = ["|", "/", "-", "\\"] as const
    const spinner = spinnerFrames[Math.floor((nowMs() - this.startedAt) / 120) % spinnerFrames.length]
    const idleForMs = nowMs() - this.lastActivityAt

    const header = chalk.bold("shadxn generate") + chalk.dim(`  ${formatDuration(nowMs() - this.startedAt)}`)
    const meta1 = `${chalk.dim("Task:")} ${this.opts.task}`
    const meta2 =
      `${chalk.dim("Provider:")} ${this.opts.provider}` +
      (this.opts.model ? `  ${chalk.dim("Model:")} ${this.opts.model}` : "") +
      `  ${chalk.dim("Type:")} ${this.outputType}`

    const meta3 =
      `${chalk.dim("CWD:")} ${this.opts.cwd}` +
      (this.opts.outputDir ? `  ${chalk.dim("Out:")} ${this.opts.outputDir}` : "") +
      (this.opts.overwrite ? `  ${chalk.dim("Overwrite:")} yes` : "") +
      (this.opts.dryRun ? `  ${chalk.dim("Dry-run:")} yes` : "")

    const status =
      `${chalk.dim("Status:")} ${chalk.bold(this.phase)} ${chalk.dim(spinner)}` +
      (this.iteration ? `  ${chalk.dim("Step:")} ${this.iteration}${this.maxSteps ? `/${this.maxSteps}` : ""}` : "") +
      (idleForMs > 1500 ? `  ${chalk.dim("Idle:")} ${formatDuration(idleForMs)}` : "") +
      (this.filesWritten || this.filesSkipped || this.filesErrors
        ? `  ${chalk.dim("Files:")} ${chalk.green(String(this.filesWritten))} written, ${chalk.yellow(String(this.filesSkipped))} skipped, ${chalk.red(String(this.filesErrors))} failed`
        : (this.filesCreated ? `  ${chalk.dim("Files:")} ${this.filesCreated} created` : ""))

    const sep = chalk.dim("".padEnd(Math.min(cols, 80), "─"))

    // Leave room for header/meta/status/sep lines.
    const fixedLines = 6
    const available = Math.max(0, rows - fixedLines)
    const outputLines = Math.max(6, Math.floor(available * 0.55))
    const eventLines = Math.max(4, available - outputLines)

    const eventTail = this.eventLog.slice(-eventLines)
    const outTailLines = tailLines(this.textTail, outputLines)

    const body = [
      header,
      meta1,
      meta2,
      meta3,
      status,
      sep,
      chalk.dim("Events:"),
      ...eventTail.map((l) => l.slice(0, cols)),
      sep,
      chalk.dim("Output (tail):"),
      ...outTailLines.map((l) => l.slice(0, cols)),
    ].join("\n")

    // Clear screen and render from top-left.
    process.stdout.write("\x1b[H\x1b[2J")
    process.stdout.write(body)
  }

  private installRestoreHandlers(): void {
    if (this.restoreHandlersInstalled) return
    this.restoreHandlersInstalled = true
    process.once("exit", this.handleExit)
    process.once("SIGINT", this.handleSigint)
    process.once("SIGTERM", this.handleSigterm)
  }

  private uninstallRestoreHandlers(): void {
    if (!this.restoreHandlersInstalled) return
    this.restoreHandlersInstalled = false
    process.off("exit", this.handleExit)
    process.off("SIGINT", this.handleSigint)
    process.off("SIGTERM", this.handleSigterm)
  }
}
