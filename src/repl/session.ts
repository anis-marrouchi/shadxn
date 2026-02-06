import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
import path from "path"
import os from "os"
import type { GenerationMessage } from "@/src/agent/providers/types"

// --- Session management for REPL persistence ---

export interface Session {
  id: string
  createdAt: string
  updatedAt: string
  cwd: string
  messages: GenerationMessage[]
  tokensUsed: number
  filesGenerated: string[]
}

const SESSIONS_DIR = path.join(os.homedir(), ".shadxn", "sessions")

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

/**
 * Create a new session.
 */
export function createSession(cwd: string): Session {
  const id = generateId()
  return {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd,
    messages: [],
    tokensUsed: 0,
    filesGenerated: [],
  }
}

/**
 * Save a session to disk.
 */
export function saveSession(session: Session): void {
  ensureSessionsDir()
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`)
  session.updatedAt = new Date().toISOString()
  writeFileSync(filePath, JSON.stringify(session, null, 2), "utf8")
}

/**
 * Load a session from disk.
 */
export function loadSession(id: string): Session | null {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Session
  } catch {
    return null
  }
}

/**
 * Load the most recent session.
 */
export function loadLatestSession(): Session | null {
  ensureSessionsDir()
  const files = readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      path: path.join(SESSIONS_DIR, f),
    }))

  if (!files.length) return null

  // Sort by modification time, most recent first
  let latest: { name: string; session: Session } | null = null
  for (const file of files) {
    try {
      const session = JSON.parse(readFileSync(file.path, "utf8")) as Session
      if (!latest || session.updatedAt > latest.session.updatedAt) {
        latest = { name: file.name, session }
      }
    } catch {
      // Skip corrupted files
    }
  }

  return latest?.session ?? null
}

/**
 * List all saved sessions.
 */
export function listSessions(): Session[] {
  ensureSessionsDir()
  const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"))
  const sessions: Session[] = []

  for (const file of files) {
    try {
      const session = JSON.parse(
        readFileSync(path.join(SESSIONS_DIR, file), "utf8")
      ) as Session
      sessions.push(session)
    } catch {
      // Skip corrupted files
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sessions
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
