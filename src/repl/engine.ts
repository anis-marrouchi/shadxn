import { createInterface, type Interface } from "readline"
import chalk from "chalk"
import ora from "ora"
import type { Session } from "./session"
import { createSession, saveSession, loadSession, loadLatestSession } from "./session"
import { isCommand, parseCommand, getCommand, type CommandContext } from "./commands"
import { renderBanner, renderResponse, renderFiles, renderCost } from "./renderer"
import { generate, type GenerateOptions } from "@/src/agent"
import type { GenerationMessage } from "@/src/agent/providers/types"
import { logger } from "@/src/utils/logger"

// --- REPL Engine ---

export interface ReplOptions {
  cwd: string
  provider?: string
  model?: string
  apiKey?: string
  resume?: boolean
  sessionId?: string
  version: string
}

export class ReplEngine {
  private rl: Interface | null = null
  private session: Session
  private options: ReplOptions
  private running = false

  constructor(options: ReplOptions) {
    this.options = options

    // Resume or create session
    if (options.sessionId) {
      const loaded = loadSession(options.sessionId)
      if (!loaded) {
        logger.warn(`Session ${options.sessionId} not found, starting new session`)
        this.session = createSession(options.cwd)
      } else {
        this.session = loaded
      }
    } else if (options.resume) {
      const latest = loadLatestSession()
      if (!latest) {
        logger.info("No previous session found, starting new session")
        this.session = createSession(options.cwd)
      } else {
        this.session = latest
        logger.info(`Resumed session: ${latest.id}`)
      }
    } else {
      this.session = createSession(options.cwd)
    }
  }

  /**
   * Start the REPL loop.
   */
  async start(): Promise<void> {
    this.running = true
    renderBanner(this.options.version, this.session.id)

    // Show resumed session context
    if (this.session.messages.length > 0) {
      console.log(
        chalk.dim(
          `  Resumed with ${this.session.messages.length} messages, ${this.session.tokensUsed.toLocaleString()} tokens`
        )
      )
      console.log()
    }

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("shadxn > "),
      terminal: true,
    })

    this.rl.prompt()

    this.rl.on("line", async (line) => {
      const input = line.trim()

      if (!input) {
        this.rl?.prompt()
        return
      }

      try {
        if (isCommand(input)) {
          const shouldContinue = await this.handleCommand(input)
          if (!shouldContinue) {
            this.stop()
            return
          }
        } else {
          await this.handleGeneration(input)
        }
      } catch (error: any) {
        logger.error(`  Error: ${error.message}`)
      }

      if (this.running) {
        this.rl?.prompt()
      }
    })

    this.rl.on("close", () => {
      this.stop()
    })

    // Handle Ctrl+C gracefully
    this.rl.on("SIGINT", () => {
      console.log()
      this.stop()
    })
  }

  /**
   * Stop the REPL and save session.
   */
  private stop(): void {
    this.running = false
    saveSession(this.session)
    console.log()
    console.log(chalk.dim(`  Session saved: ${this.session.id}`))
    renderCost(this.session.tokensUsed)
    console.log()
    this.rl?.close()
    process.exit(0)
  }

  /**
   * Handle a slash command.
   */
  private async handleCommand(input: string): Promise<boolean> {
    const { name, args } = parseCommand(input)
    const handler = getCommand(name)

    if (!handler) {
      logger.warn(`  Unknown command: /${name}. Type /help for available commands.`)
      return true
    }

    const ctx: CommandContext = {
      session: this.session,
      cwd: this.options.cwd,
      onSessionChange: (newSession) => {
        this.session = newSession
      },
    }

    return handler(args, ctx)
  }

  /**
   * Handle a natural language generation prompt.
   */
  private async handleGeneration(input: string): Promise<void> {
    const spinner = ora({
      text: "Thinking...",
      color: "cyan",
    }).start()

    try {
      // Build session messages for multi-turn context (exclude system messages)
      const sessionMessages: GenerationMessage[] = this.session.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }))

      const generateOptions: GenerateOptions = {
        task: input,
        cwd: this.options.cwd,
        provider: (this.options.provider as any) || "claude-code",
        model: this.options.model,
        apiKey: this.options.apiKey,
        overwrite: true,
        dryRun: false,
        interactive: false,
        context7: true,
        sessionMessages,
      }

      const result = await generate(generateOptions)

      spinner.stop()

      // Render the response
      if (result.content) {
        renderResponse(result.content)
      }

      // Render file results
      if (result.files.written.length || result.files.skipped.length || result.files.errors.length) {
        renderFiles(result.files)
      }

      // Track cost
      if (result.tokensUsed) {
        renderCost(result.tokensUsed)
      }

      // Update session
      this.session.messages.push({ role: "user", content: input })
      this.session.messages.push({
        role: "assistant",
        content: result.content || "",
      })
      this.session.tokensUsed += result.tokensUsed || 0
      this.session.filesGenerated.push(...result.files.written)

      // Handle follow-up questions
      if (result.followUp) {
        console.log()
        console.log(chalk.yellow(`  ${result.followUp}`))
      }
    } catch (error: any) {
      spinner.stop()
      throw error
    }
  }
}
