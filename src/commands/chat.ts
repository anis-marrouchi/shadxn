import { existsSync } from "fs"
import path from "path"
import { Command } from "commander"
import chalk from "chalk"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { getPackageInfo } from "@/src/utils/get-package-info"
import { ReplEngine } from "@/src/repl"
import { listSessions } from "@/src/repl/session"
import { setDebug } from "@/src/observability"
import { globalPermissions, type PermissionMode } from "@/src/permissions"

export const chat = new Command()
  .name("chat")
  .description("start an interactive AI coding session")
  .option("--resume", "resume the last session", false)
  .option("-s, --session <id>", "resume a specific session")
  .option("--list", "list saved sessions", false)
  .option(
    "-p, --provider <provider>",
    "AI provider (claude-code, claude)",
    "claude-code"
  )
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key for the provider")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--debug", "enable debug mode with verbose logging", false)
  .option("--mode <mode>", "permission mode (default, acceptEdits, plan, yolo)", "yolo")
  .action(async (opts) => {
    try {
      // List sessions mode
      if (opts.list) {
        const sessions = listSessions()
        if (!sessions.length) {
          logger.info("No saved sessions")
          return
        }

        console.log()
        console.log(chalk.bold("  Saved sessions:"))
        console.log()
        for (const s of sessions.slice(0, 20)) {
          const date = new Date(s.updatedAt).toLocaleDateString()
          const msgs = s.messages.length
          const tokens = s.tokensUsed.toLocaleString()
          console.log(
            `  ${chalk.cyan(s.id)}  ${date}  ${msgs} msgs  ${tokens} tokens`
          )
        }
        console.log()
        return
      }

      if (opts.debug) {
        setDebug(true)
      }

      if (opts.mode) {
        globalPermissions.setMode(opts.mode as PermissionMode)
      }

      const cwd = path.resolve(opts.cwd)
      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist.`)
        process.exit(1)
      }

      const packageInfo = await getPackageInfo()

      const engine = new ReplEngine({
        cwd,
        provider: opts.provider,
        model: opts.model,
        apiKey: opts.apiKey,
        resume: opts.resume,
        sessionId: opts.session,
        version: packageInfo.version || "1.0.0",
      })

      await engine.start()
    } catch (error) {
      handleError(error)
    }
  })
