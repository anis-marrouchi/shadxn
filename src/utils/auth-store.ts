import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import os from "os"

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
