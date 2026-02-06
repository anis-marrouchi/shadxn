import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { loadAuthConfig, saveAuthConfig, resolveToken, type AuthConfig } from "@/src/utils/auth-store"
import chalk from "chalk"
import { Command } from "commander"
import prompts from "prompts"

const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-20250514", label: "anthropic/claude-sonnet-4", hint: "Claude Sonnet 4 · ctx 200k · recommended" },
  { id: "claude-opus-4-20250514", label: "anthropic/claude-opus-4-5", hint: "Claude Opus 4.5 · ctx 200k · reasoning" },
  { id: "claude-haiku-4-20250514", label: "anthropic/claude-haiku-4", hint: "Claude Haiku 4 · ctx 200k · fast" },
]

// --- Auth method handlers ---

async function handleApiKey(): Promise<{ token: string; authType: "api-key" } | null> {
  // Check for existing env var
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey?.trim()) {
    const preview = envKey.slice(0, 10) + "..." + envKey.slice(-4)
    const { useExisting } = await prompts({
      type: "confirm",
      name: "useExisting",
      message: `Use existing ANTHROPIC_API_KEY (env, ${preview})?`,
      initial: true,
    })

    if (useExisting) {
      return { token: envKey.trim(), authType: "api-key" }
    }
  }

  // Check stored config
  const stored = loadAuthConfig()
  if (stored?.authType === "api-key" && stored.token) {
    const preview = stored.token.slice(0, 10) + "..." + stored.token.slice(-4)
    const { useExisting } = await prompts({
      type: "confirm",
      name: "useExisting",
      message: `Use stored API key (${preview})?`,
      initial: true,
    })

    if (useExisting) {
      return { token: stored.token, authType: "api-key" }
    }
  }

  const { apiKey } = await prompts({
    type: "password",
    name: "apiKey",
    message: "Enter Anthropic API key",
    validate: (v: string) => {
      if (!v.startsWith("sk-ant-api")) return "API key must start with sk-ant-api"
      if (v.length < 40) return "API key seems too short"
      return true
    },
  })

  if (!apiKey) return null
  return { token: apiKey, authType: "api-key" }
}

async function handleSetupToken(): Promise<{ token: string; authType: "oauth" } | null> {
  // Show instructions note
  logger.break()
  const boxWidth = 46
  const line1 = "Run `claude setup-token` in your terminal."
  const line2 = "Then paste the generated token below."
  console.log(`  ${chalk.cyan("Anthropic setup-token")} ${"─".repeat(boxWidth - "Anthropic setup-token".length - 1)}╮`)
  console.log(`  ${" ".repeat(boxWidth)}│`)
  console.log(`  ${line1}${" ".repeat(boxWidth - line1.length)}│`)
  console.log(`  ${line2}${" ".repeat(boxWidth - line2.length)}│`)
  console.log(`  ${" ".repeat(boxWidth)}│`)
  console.log(`  ${"─".repeat(boxWidth)}╯`)
  logger.break()

  const { token } = await prompts({
    type: "password",
    name: "token",
    message: "Paste Anthropic setup-token",
    validate: (v: string) => {
      if (!v.trim()) return "Token is required"
      if (v.length < 40) return "Token seems too short"
      return true
    },
  })

  if (!token) return null

  // Token name (blank = default) — matches OpenClaw UX
  const { tokenName } = await prompts({
    type: "text",
    name: "tokenName",
    message: "Token name (blank = default)",
  })

  return { token, authType: "oauth" }
}

// --- Two-level auth selection ---

type AuthResult = { token: string; authType: "api-key" | "oauth" } | null

async function selectAuthMethod(): Promise<AuthResult> {
  while (true) {
    // Level 1: Provider group
    const { provider } = await prompts({
      type: "select",
      name: "provider",
      message: "Model/auth provider",
      choices: [
        { title: "Anthropic", value: "anthropic", description: "setup-token + API key" },
      ],
    })

    if (provider === undefined) return null

    // Level 2: Auth method within provider
    const { method } = await prompts({
      type: "select",
      name: "method",
      message: "Anthropic auth method",
      choices: [
        { title: "Anthropic token (paste setup-token)", value: "setup-token", description: "run `claude setup-token` elsewhere, then paste the token here" },
        { title: "Anthropic API key", value: "api-key" },
        { title: chalk.dim("Back"), value: "back" },
      ],
    })

    if (method === undefined) return null
    if (method === "back") continue

    if (method === "api-key") return handleApiKey()
    if (method === "setup-token") return handleSetupToken()

    return null
  }
}

// --- Model selection ---

async function selectModel(): Promise<string | null> {
  const stored = loadAuthConfig()

  const choices = ANTHROPIC_MODELS.map((m) => ({
    title: m.label,
    value: m.id,
    description: m.hint + (stored?.model === m.id ? " · current" : ""),
  }))

  // If there's a stored model, add "Keep current" at top
  if (stored?.model) {
    const current = ANTHROPIC_MODELS.find((m) => m.id === stored.model)
    const label = current ? current.label : stored.model
    choices.unshift({
      title: `Keep current (${label})`,
      value: stored.model,
      description: "no change",
    })
  }

  const { modelId } = await prompts({
    type: "select",
    name: "modelId",
    message: "Default model",
    choices,
  })

  return modelId || null
}

/**
 * Reusable interactive setup flow. Returns the saved config, or null if the user cancelled.
 * Follows the OpenClaw onboard pattern: save immediately, no eager API verification.
 */
export async function runModelSetup(): Promise<AuthConfig | null> {
  // 1. Auth method selection (two-level)
  const auth = await selectAuthMethod()
  if (!auth) return null

  // 2. Model selection
  const modelId = await selectModel()
  if (!modelId) return null

  // 3. Save config (no eager verification — matches OpenClaw behavior)
  const config: AuthConfig = {
    provider: auth.authType === "oauth" ? "claude-code" : "claude",
    authType: auth.authType,
    token: auth.token,
    model: modelId,
  }

  saveAuthConfig(config)

  logger.break()
  logger.success("Configuration saved to ~/.shadxn/auth.json")
  console.log(`  Provider:  ${chalk.bold("anthropic")} (${config.authType})`)
  console.log(`  Model:     ${chalk.bold(ANTHROPIC_MODELS.find((m) => m.id === config.model)?.label || config.model)}`)

  return config
}

/**
 * Ensure credentials are available. If not, auto-prompt the interactive setup.
 * Returns true if credentials are ready, false if user cancelled.
 */
export async function ensureCredentials(explicitKey?: string): Promise<boolean> {
  const resolved = resolveToken(explicitKey)
  if (resolved) return true

  logger.warn("No AI credentials configured.")
  logger.break()

  const result = await runModelSetup()
  return result !== null
}

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
