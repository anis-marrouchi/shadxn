import chalk from "chalk"
import type { WriteResult } from "@/agent/outputs/handlers"
import type { UsageSummary } from "@/observability"

// --- Terminal rendering utilities for the REPL ---

/**
 * Render the REPL welcome banner.
 */
export function renderBanner(version: string, sessionId: string): void {
  console.log()
  console.log(chalk.bold.cyan("  shadxn") + chalk.dim(` v${version}`))
  console.log(chalk.dim(`  Session: ${sessionId}`))
  console.log(chalk.dim("  Type /help for commands, /quit to exit"))
  console.log()
}

/**
 * Render file write results.
 */
export function renderFiles(result: WriteResult): void {
  if (result.written.length) {
    console.log()
    console.log(chalk.green(`  Created ${result.written.length} file(s):`))
    for (const file of result.written) {
      console.log(`    ${chalk.green("+")} ${file}`)
    }
  }

  if (result.skipped.length) {
    console.log()
    console.log(chalk.yellow(`  Skipped ${result.skipped.length} file(s):`))
    for (const file of result.skipped) {
      console.log(`    ${chalk.yellow("~")} ${file}`)
    }
  }

  if (result.errors.length) {
    console.log()
    console.log(chalk.red(`  Failed ${result.errors.length} file(s):`))
    for (const err of result.errors) {
      console.log(`    ${chalk.red("x")} ${err}`)
    }
  }
}

/**
 * Render token usage and cost estimate.
 */
export function renderCost(tokensUsed: number): void {
  // Rough cost estimate based on Sonnet pricing ($3/MTok input, $15/MTok output)
  // We only have total tokens, so use a blended rate of ~$9/MTok
  const cost = (tokensUsed / 1_000_000) * 9
  console.log()
  console.log(
    chalk.dim(`  Tokens: ${tokensUsed.toLocaleString()} | Est. cost: $${cost.toFixed(4)}`)
  )
}

/**
 * Render AI response text with basic formatting.
 */
export function renderResponse(content: string): void {
  if (!content.trim()) return
  console.log()

  // Simple rendering: preserve code blocks, add indentation
  const lines = content.split("\n")
  let inCodeBlock = false

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock
      console.log(chalk.dim(`  ${line}`))
      continue
    }

    if (inCodeBlock) {
      console.log(chalk.dim(`  ${line}`))
    } else {
      console.log(`  ${line}`)
    }
  }
}

/**
 * Render a streaming text chunk (no newline).
 */
export function renderStreamChunk(text: string): void {
  process.stdout.write(text)
}

/**
 * Render help text for REPL commands.
 */
export function renderHelp(): void {
  console.log()
  console.log(chalk.bold("  Commands:"))
  console.log()
  console.log(`  ${chalk.cyan("/help")}      Show this help`)
  console.log(`  ${chalk.cyan("/clear")}     Clear conversation history`)
  console.log(`  ${chalk.cyan("/save")}      Save current session`)
  console.log(`  ${chalk.cyan("/load")}      Load a saved session`)
  console.log(`  ${chalk.cyan("/undo")}      Undo last generation`)
  console.log(`  ${chalk.cyan("/cost")}      Show token usage and cost breakdown`)
  console.log(`  ${chalk.cyan("/export")}    Export session as markdown`)
  console.log(`  ${chalk.cyan("/files")}     List generated files`)
  console.log(`  ${chalk.cyan("/context")}   Show session context info`)
  console.log(`  ${chalk.cyan("/memory")}    Show memory stats and preferences`)
  console.log(`  ${chalk.cyan("/mode")}      Switch permission mode`)
  console.log(`  ${chalk.cyan("/commit")}    Commit generated files with AI message`)
  console.log(`  ${chalk.cyan("/diff")}      Show git diff`)
  console.log(`  ${chalk.cyan("/status")}    Show git status`)
  console.log(`  ${chalk.cyan("/quit")}      Exit the REPL`)
  console.log()
}

/**
 * Render a git status summary.
 */
export function renderGitStatus(status: {
  branch: string
  staged: string[]
  modified: string[]
  untracked: string[]
  isClean: boolean
}): void {
  console.log()
  console.log(chalk.dim(`  Branch: ${status.branch}`))

  if (status.isClean) {
    console.log(chalk.green("  Working tree clean"))
    return
  }

  if (status.staged.length) {
    console.log(chalk.green(`  Staged: ${status.staged.length}`))
  }
  if (status.modified.length) {
    console.log(chalk.yellow(`  Modified: ${status.modified.length}`))
  }
  if (status.untracked.length) {
    console.log(chalk.dim(`  Untracked: ${status.untracked.length}`))
  }
  console.log()
}

/**
 * Render detailed cost breakdown with per-step and per-model info.
 */
export function renderCostBreakdown(summary: UsageSummary): void {
  console.log()
  console.log(chalk.bold("  Cost Breakdown"))
  console.log()
  console.log(
    chalk.dim(
      `  Total: ${summary.totalTokens.toLocaleString()} tokens ($${summary.totalCost.toFixed(4)})`
    )
  )
  console.log(
    chalk.dim(
      `  Input: ${summary.totalInputTokens.toLocaleString()} | Output: ${summary.totalOutputTokens.toLocaleString()}`
    )
  )

  if (Object.keys(summary.models).length) {
    console.log()
    console.log(chalk.dim("  Per model:"))
    for (const [model, usage] of Object.entries(summary.models)) {
      console.log(
        `    ${chalk.cyan(model)}: ${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens, $${usage.cost.toFixed(4)} (${usage.steps} step${usage.steps !== 1 ? "s" : ""})`
      )
    }
  }

  if (summary.steps.length > 1) {
    console.log()
    console.log(chalk.dim("  Per step:"))
    for (const step of summary.steps) {
      console.log(
        `    Step ${step.step}: ${(step.inputTokens + step.outputTokens).toLocaleString()} tokens ($${step.cost.toFixed(4)})`
      )
    }
  }
  console.log()
}

/**
 * Render a plan preview showing what files would be written (for plan mode).
 */
export function renderPlan(files: Array<{ path: string; action: string }>): void {
  console.log()
  console.log(chalk.bold("  Plan Preview"))
  console.log(chalk.dim("  No files will be written in plan mode."))
  console.log()
  for (const file of files) {
    const icon = file.action === "create" ? chalk.green("+") : chalk.yellow("~")
    console.log(`    ${icon} ${file.path} (${file.action})`)
  }
  console.log()
}
