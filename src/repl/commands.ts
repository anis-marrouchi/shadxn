import chalk from "chalk"
import type { Session } from "./session"
import { saveSession, loadSession, loadLatestSession, listSessions } from "./session"
import { renderHelp, renderCost, renderGitStatus } from "./renderer"
import { GitManager } from "@/src/git"
import { createProvider } from "@/src/agent/providers"
import { logger } from "@/src/utils/logger"
import prompts from "prompts"

// --- REPL slash commands ---

export interface CommandContext {
  session: Session
  cwd: string
  onSessionChange: (session: Session) => void
}

export type SlashCommandHandler = (
  args: string,
  ctx: CommandContext
) => Promise<boolean> // Returns true to continue REPL, false to quit

const commands: Record<string, SlashCommandHandler> = {}

export function registerCommand(name: string, handler: SlashCommandHandler): void {
  commands[name] = handler
}

export function getCommand(name: string): SlashCommandHandler | undefined {
  return commands[name]
}

export function isCommand(input: string): boolean {
  return input.startsWith("/")
}

export function parseCommand(input: string): { name: string; args: string } {
  const trimmed = input.trim()
  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) {
    return { name: trimmed.slice(1), args: "" }
  }
  return {
    name: trimmed.slice(1, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}

// --- Built-in commands ---

registerCommand("help", async () => {
  renderHelp()
  return true
})

registerCommand("quit", async () => {
  return false
})

registerCommand("exit", async () => {
  return false
})

registerCommand("q", async () => {
  return false
})

registerCommand("clear", async (_args, ctx) => {
  ctx.session.messages = []
  console.log(chalk.dim("  Conversation cleared"))
  return true
})

registerCommand("save", async (_args, ctx) => {
  saveSession(ctx.session)
  console.log(chalk.dim(`  Session saved: ${ctx.session.id}`))
  return true
})

registerCommand("load", async (args, ctx) => {
  let session: Session | null = null

  if (args) {
    session = loadSession(args)
    if (!session) {
      logger.warn(`Session not found: ${args}`)
      return true
    }
  } else {
    // Show session list and let user pick
    const sessions = listSessions()
    if (!sessions.length) {
      logger.info("No saved sessions")
      return true
    }

    const { sessionId } = await prompts({
      type: "select",
      name: "sessionId",
      message: "Select a session",
      choices: sessions.slice(0, 10).map((s) => ({
        title: `${s.id} — ${new Date(s.updatedAt).toLocaleDateString()} (${s.messages.length} messages)`,
        value: s.id,
      })),
    })

    if (!sessionId) return true
    session = loadSession(sessionId)
  }

  if (session) {
    ctx.onSessionChange(session)
    console.log(
      chalk.dim(`  Loaded session: ${session.id} (${session.messages.length} messages)`)
    )
  }

  return true
})

registerCommand("undo", async (_args, ctx) => {
  // Remove last assistant + user message pair
  const messages = ctx.session.messages
  if (messages.length < 2) {
    logger.info("Nothing to undo")
    return true
  }

  // Pop from the end: assistant response, then user prompt
  if (messages[messages.length - 1]?.role === "assistant") {
    messages.pop()
  }
  if (messages[messages.length - 1]?.role === "user") {
    messages.pop()
  }

  console.log(chalk.dim("  Undid last exchange"))
  return true
})

registerCommand("cost", async (_args, ctx) => {
  renderCost(ctx.session.tokensUsed)
  return true
})

registerCommand("files", async (_args, ctx) => {
  const files = ctx.session.filesGenerated
  if (!files.length) {
    logger.info("No files generated in this session")
    return true
  }

  console.log()
  console.log(chalk.dim(`  Files generated (${files.length}):`))
  for (const f of files) {
    console.log(`    ${chalk.green("+")} ${f}`)
  }
  console.log()
  return true
})

registerCommand("context", async (_args, ctx) => {
  console.log()
  console.log(chalk.dim(`  Session: ${ctx.session.id}`))
  console.log(chalk.dim(`  CWD: ${ctx.session.cwd}`))
  console.log(chalk.dim(`  Messages: ${ctx.session.messages.length}`))
  console.log(chalk.dim(`  Tokens: ${ctx.session.tokensUsed.toLocaleString()}`))
  console.log(chalk.dim(`  Files: ${ctx.session.filesGenerated.length}`))
  console.log(chalk.dim(`  Created: ${new Date(ctx.session.createdAt).toLocaleString()}`))
  console.log()
  return true
})

// --- Git commands ---

registerCommand("commit", async (_args, ctx) => {
  try {
    const gm = new GitManager(ctx.cwd)
    if (!(await gm.isRepo())) {
      logger.warn("Not a git repository")
      return true
    }

    // Auto-stage generated files
    const generatedFiles = ctx.session.filesGenerated.filter((f) => f)
    if (generatedFiles.length) {
      await gm.add(generatedFiles)
      console.log(chalk.dim(`  Staged ${generatedFiles.length} generated file(s)`))
    }

    const status = await gm.status()
    if (status.staged.length === 0) {
      logger.warn("Nothing staged to commit")
      return true
    }

    // Generate AI commit message
    let message: string
    try {
      const provider = createProvider()
      message = await gm.generateCommitMessage(provider)
    } catch {
      message = await gm.generateCommitMessage()
    }

    console.log(chalk.dim(`  Message: ${message}`))

    const result = await gm.commit(message)
    logger.success(`  [${result.hash}] ${result.message}`)
  } catch (error: any) {
    logger.error(`  ${error.message}`)
  }

  return true
})

registerCommand("diff", async (_args, ctx) => {
  try {
    const gm = new GitManager(ctx.cwd)
    const diff = await gm.diff()
    if (!diff.trim()) {
      logger.info("No changes")
    } else {
      console.log(diff)
    }
  } catch (error: any) {
    logger.error(`  ${error.message}`)
  }
  return true
})

registerCommand("status", async (_args, ctx) => {
  try {
    const gm = new GitManager(ctx.cwd)
    if (!(await gm.isRepo())) {
      logger.warn("Not a git repository")
      return true
    }
    const status = await gm.status()
    renderGitStatus(status)
  } catch (error: any) {
    logger.error(`  ${error.message}`)
  }
  return true
})
