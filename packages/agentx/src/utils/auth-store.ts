import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import os from "os"
import chalk from "chalk"
import prompts from "prompts"
import { logger } from "@/utils/logger"

// --- Auth config stored at ~/.shadxn/auth.json ---

export interface AuthConfig {
  provider: "claude" | "claude-code"
  authType: "api-key" | "oauth"
  token: string
  model: string
}

const AUTH_DIR = path.join(os.homedir(), ".shadxn")
const AUTH_FILE = path.join(AUTH_DIR, "auth.json")

export function loadAuthConfig(): AuthConfig | null {
  if (!existsSync(AUTH_FILE)) return null
  try {
    const data = JSON.parse(readFileSync(AUTH_FILE, "utf8"))
    if (data.provider && data.authType && data.token && data.model) {
      return data as AuthConfig
    }
    return null
  } catch {
    return null
  }
}

export function saveAuthConfig(config: AuthConfig): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true })
  }
  writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2), "utf8")
}

/**
 * Resolve a token for the Anthropic API.
 * Priority: (1) explicit token, (2) env vars, (3) ~/.shadxn/auth.json, (4) OpenClaw auth stores
 */
export function resolveToken(explicitKey?: string): {
  token: string
  authType: "api-key" | "oauth"
} | null {
  // 1. Explicit CLI flag
  if (explicitKey?.trim()) {
    const type = explicitKey.startsWith("sk-ant-oat") ? "oauth" : "api-key"
    return { token: explicitKey.trim(), authType: type }
  }

  // 2. Environment variables
  const envOAuth = process.env.ANTHROPIC_OAUTH_TOKEN
  if (envOAuth?.trim()) {
    return { token: envOAuth.trim(), authType: "oauth" }
  }

  const envApiKey = process.env.ANTHROPIC_API_KEY
  if (envApiKey?.trim()) {
    return { token: envApiKey.trim(), authType: "api-key" }
  }

  // 3. Stored config
  const stored = loadAuthConfig()
  if (stored) {
    return { token: stored.token, authType: stored.authType }
  }

  // 4. OpenClaw auth-profiles store (legacy fallback)
  const homeDir = os.homedir()
  const storePaths = [
    path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json"),
    path.join(homeDir, ".openclaw", "auth-profiles.json"),
    path.join(homeDir, ".openclaw", "credentials", "oauth.json"),
    path.join(homeDir, ".claude", "oauth.json"),
    path.join(homeDir, ".config", "claude", "oauth.json"),
    path.join(homeDir, ".config", "anthropic", "oauth.json"),
  ]

  for (const p of storePaths) {
    const t = readTokenFromAuthProfiles(p)
    if (t) {
      return { token: t, authType: "oauth" }
    }
  }

  return null
}

/**
 * Read an Anthropic OAuth/token credential from an auth-profiles or oauth JSON file.
 */
function readTokenFromAuthProfiles(filePath: string): string {
  if (!existsSync(filePath)) return ""

  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"))

    // Modern auth-profiles format: { profiles: { "anthropic:xxx": { type, access/token } } }
    if (data.profiles) {
      let fallbackToken = ""
      for (const [id, cred] of Object.entries(data.profiles) as [string, any][]) {
        if (!id.startsWith("anthropic")) continue
        if (cred.type === "oauth" && cred.access) {
          if (cred.expires && Date.now() > cred.expires) {
            continue
          }
          return cred.access
        }
        if (cred.type === "token" && cred.token) {
          fallbackToken = cred.token
        }
      }
      if (fallbackToken) return fallbackToken
    }

    // Legacy oauth.json format: { anthropic: { access: "..." } }
    if (data.anthropic?.access) return data.anthropic.access
    if (data.anthropic?.token) return data.anthropic.token

    return ""
  } catch {
    return ""
  }
}

// --- Model setup & credentials ---

const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-20250514", label: "anthropic/claude-sonnet-4", hint: "Claude Sonnet 4 · ctx 200k · recommended" },
  { id: "claude-opus-4-20250514", label: "anthropic/claude-opus-4-5", hint: "Claude Opus 4.5 · ctx 200k · reasoning" },
  { id: "claude-haiku-4-20250514", label: "anthropic/claude-haiku-4", hint: "Claude Haiku 4 · ctx 200k · fast" },
]

async function handleApiKey(): Promise<{ token: string; authType: "api-key" } | null> {
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

  const { tokenName } = await prompts({
    type: "text",
    name: "tokenName",
    message: "Token name (blank = default)",
  })

  return { token, authType: "oauth" }
}

type AuthResult = { token: string; authType: "api-key" | "oauth" } | null

async function selectAuthMethod(): Promise<AuthResult> {
  while (true) {
    const { provider } = await prompts({
      type: "select",
      name: "provider",
      message: "Model/auth provider",
      choices: [
        { title: "Anthropic", value: "anthropic", description: "setup-token + API key" },
      ],
    })

    if (provider === undefined) return null

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

async function selectModel(): Promise<string | null> {
  const stored = loadAuthConfig()

  const choices = ANTHROPIC_MODELS.map((m) => ({
    title: m.label,
    value: m.id,
    description: m.hint + (stored?.model === m.id ? " · current" : ""),
  }))

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
 */
export async function runModelSetup(): Promise<AuthConfig | null> {
  const auth = await selectAuthMethod()
  if (!auth) return null

  const modelId = await selectModel()
  if (!modelId) return null

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
