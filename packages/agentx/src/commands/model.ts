import { handleError } from "@/utils/handle-error"
import { logger } from "@/utils/logger"
import { loadAuthConfig, runModelSetup, type AuthConfig } from "@/utils/auth-store"
import chalk from "chalk"
import { Command } from "commander"

const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-20250514", label: "anthropic/claude-sonnet-4", hint: "Claude Sonnet 4 · ctx 200k · recommended" },
  { id: "claude-opus-4-20250514", label: "anthropic/claude-opus-4-5", hint: "Claude Opus 4.5 · ctx 200k · reasoning" },
  { id: "claude-haiku-4-20250514", label: "anthropic/claude-haiku-4", hint: "Claude Haiku 4 · ctx 200k · fast" },
]

export const model = new Command()
  .name("model")
  .description("configure AI provider, credentials, and model")

// --- model (default: interactive setup) ---
model
  .command("setup", { isDefault: true })
  .description("interactively configure provider and model")
  .action(async () => {
    try {
      const result = await runModelSetup()
      if (!result) process.exit(0)
    } catch (e) {
      handleError(e)
    }
  })

// --- model show ---
model
  .command("show")
  .description("display current provider and model configuration")
  .action(async () => {
    try {
      const config = loadAuthConfig()

      if (!config) {
        logger.warn("No configuration found. Run `shadxn model` to set up.")
        process.exit(0)
      }

      const modelLabel = ANTHROPIC_MODELS.find((m) => m.id === config.model)?.label || config.model

      console.log(chalk.bold("\nCurrent configuration:"))
      console.log(`  Provider:  ${chalk.cyan("anthropic")} (${config.authType})`)
      console.log(`  Model:     ${chalk.cyan(modelLabel)}`)
      console.log(`  Token:     ${chalk.dim(maskToken(config.token))}`)
      console.log(`  File:      ${chalk.dim("~/.shadxn/auth.json")}`)

      if (process.env.ANTHROPIC_API_KEY) {
        console.log(chalk.yellow("\n  Note: ANTHROPIC_API_KEY env var is set (takes priority)"))
      }
      if (process.env.ANTHROPIC_OAUTH_TOKEN) {
        console.log(chalk.yellow("\n  Note: ANTHROPIC_OAUTH_TOKEN env var is set (takes priority)"))
      }
      console.log()
    } catch (e) {
      handleError(e)
    }
  })

function maskToken(token: string): string {
  if (token.length < 12) return "***"
  return token.slice(0, 10) + "..." + token.slice(-4)
}
