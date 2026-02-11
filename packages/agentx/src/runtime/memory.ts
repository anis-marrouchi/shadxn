import { existsSync, promises as fs } from "fs"
import path from "path"

// --- Memory System: persistent learning from past generations ---
// shadxn remembers what it generated, what worked, what failed,
// user preferences, and successful patterns. Every interaction
// makes it smarter.

export interface MemoryEntry {
  id: string
  timestamp: number
  type: "generation" | "evolution" | "heal" | "skill" | "feedback" | "pattern"
  task: string
  outputType?: string
  files: string[]
  success: boolean
  error?: string
  userFeedback?: "positive" | "negative" | "neutral"
  context: {
    techStack?: string[]
    frameworks?: string[]
    skillsUsed?: string[]
  }
  metadata?: Record<string, unknown>
}

export interface LearnedPattern {
  id: string
  description: string
  frequency: number
  lastUsed: number
  techStack: string[]
  example?: string
}

export interface UserPreference {
  key: string
  value: string
  confidence: number // 0-1, increases with repeated preference
  source: string // what interaction inferred this
}

export interface MemoryStore {
  version: number
  entries: MemoryEntry[]
  patterns: LearnedPattern[]
  preferences: UserPreference[]
  stats: {
    totalGenerations: number
    successRate: number
    totalHeals: number
    skillsGenerated: number
  }
}

const MEMORY_DIR = ".shadxn"
const MEMORY_FILE = "memory.json"
const MAX_ENTRIES = 500
const MEMORY_VERSION = 1

function createEmptyStore(): MemoryStore {
  return {
    version: MEMORY_VERSION,
    entries: [],
    patterns: [],
    preferences: [],
    stats: {
      totalGenerations: 0,
      successRate: 1.0,
      totalHeals: 0,
      skillsGenerated: 0,
    },
  }
}

export class Memory {
  private store: MemoryStore
  private memoryPath: string
  private dirty = false

  constructor(private cwd: string) {
    this.memoryPath = path.resolve(cwd, MEMORY_DIR, MEMORY_FILE)
    this.store = createEmptyStore()
  }

  async load(): Promise<void> {
    try {
      if (existsSync(this.memoryPath)) {
        const raw = await fs.readFile(this.memoryPath, "utf8")
        this.store = JSON.parse(raw)
      }
    } catch {
      this.store = createEmptyStore()
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return
    const dir = path.dirname(this.memoryPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.memoryPath, JSON.stringify(this.store, null, 2), "utf8")
    this.dirty = false
  }

  // --- Record events ---

  async recordGeneration(
    entry: Omit<MemoryEntry, "id" | "timestamp" | "type"> & { type?: MemoryEntry["type"] }
  ): Promise<string> {
    const id = generateId()
    this.store.entries.push({
      id,
      timestamp: Date.now(),
      type: entry.type || "generation",
      ...entry,
    })
    this.store.stats.totalGenerations++
    this.updateSuccessRate()
    this.trimEntries()
    this.dirty = true
    await this.save()
    return id
  }

  async recordHeal(
    originalEntryId: string,
    error: string,
    fixed: boolean,
    fixFiles: string[]
  ): Promise<void> {
    this.store.entries.push({
      id: generateId(),
      timestamp: Date.now(),
      type: "heal",
      task: `Auto-heal for ${originalEntryId}: ${error}`,
      files: fixFiles,
      success: fixed,
      error: fixed ? undefined : error,
      context: {},
    })
    this.store.stats.totalHeals++
    this.dirty = true
    await this.save()
  }

  async recordFeedback(entryId: string, feedback: "positive" | "negative" | "neutral"): Promise<void> {
    const entry = this.store.entries.find((e) => e.id === entryId)
    if (entry) {
      entry.userFeedback = feedback
      if (feedback === "positive") {
        await this.extractPattern(entry)
      }
      this.dirty = true
      await this.save()
    }
  }

  async learnPreference(key: string, value: string, source: string): Promise<void> {
    const existing = this.store.preferences.find((p) => p.key === key)
    if (existing) {
      if (existing.value === value) {
        existing.confidence = Math.min(existing.confidence + 0.1, 1.0)
      } else {
        existing.value = value
        existing.confidence = 0.5
      }
      existing.source = source
    } else {
      this.store.preferences.push({ key, value, confidence: 0.5, source })
    }
    this.dirty = true
    await this.save()
  }

  // --- Query memory ---

  getRecentGenerations(limit = 10): MemoryEntry[] {
    return this.store.entries
      .filter((e) => e.type === "generation")
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  getFailedGenerations(limit = 5): MemoryEntry[] {
    return this.store.entries
      .filter((e) => !e.success)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  getSimilarTasks(task: string, limit = 5): MemoryEntry[] {
    const taskWords = new Set(task.toLowerCase().split(/\s+/).filter((w) => w.length > 3))
    return this.store.entries
      .filter((e) => e.type === "generation" && e.success)
      .map((e) => {
        const entryWords = new Set(e.task.toLowerCase().split(/\s+/).filter((w) => w.length > 3))
        const overlap = [...taskWords].filter((w) => entryWords.has(w)).length
        return { entry: e, score: overlap }
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((e) => e.entry)
  }

  getPatterns(): LearnedPattern[] {
    return this.store.patterns.sort((a, b) => b.frequency - a.frequency)
  }

  getPreferences(): UserPreference[] {
    return this.store.preferences.filter((p) => p.confidence > 0.3)
  }

  getStats(): MemoryStore["stats"] {
    return { ...this.store.stats }
  }

  // --- Build context for agent ---

  buildMemoryContext(task: string): string {
    const sections: string[] = []

    // Similar past tasks
    const similar = this.getSimilarTasks(task, 3)
    if (similar.length) {
      sections.push(
        "## Relevant Past Generations\n" +
          similar
            .map(
              (s) =>
                `- Task: "${s.task}" → ${s.success ? "succeeded" : "failed"}${s.files.length ? ` (files: ${s.files.join(", ")})` : ""}${s.userFeedback === "positive" ? " (user liked this)" : ""}`
            )
            .join("\n")
      )
    }

    // Known failures to avoid
    const failures = this.getFailedGenerations(3)
    if (failures.length) {
      sections.push(
        "## Past Failures (avoid these patterns)\n" +
          failures
            .map((f) => `- "${f.task}": ${f.error || "unknown error"}`)
            .join("\n")
      )
    }

    // Learned patterns
    const patterns = this.getPatterns().slice(0, 5)
    if (patterns.length) {
      sections.push(
        "## Learned Patterns\n" +
          patterns.map((p) => `- ${p.description}`).join("\n")
      )
    }

    // User preferences
    const prefs = this.getPreferences()
    if (prefs.length) {
      sections.push(
        "## User Preferences\n" +
          prefs.map((p) => `- ${p.key}: ${p.value}`).join("\n")
      )
    }

    if (!sections.length) return ""
    return `# Memory (learned from past interactions)\n\n${sections.join("\n\n")}`
  }

  // --- Internal ---

  private async extractPattern(entry: MemoryEntry): Promise<void> {
    const description = `When asked "${truncate(entry.task, 80)}", generated ${entry.files.length} file(s) successfully`
    const existing = this.store.patterns.find(
      (p) => p.description === description
    )
    if (existing) {
      existing.frequency++
      existing.lastUsed = Date.now()
    } else {
      this.store.patterns.push({
        id: generateId(),
        description,
        frequency: 1,
        lastUsed: Date.now(),
        techStack: entry.context.techStack || [],
      })
    }
  }

  private updateSuccessRate(): void {
    const gens = this.store.entries.filter((e) => e.type === "generation")
    if (gens.length === 0) {
      this.store.stats.successRate = 1.0
      return
    }
    const successes = gens.filter((e) => e.success).length
    this.store.stats.successRate = successes / gens.length
  }

  private trimEntries(): void {
    if (this.store.entries.length > MAX_ENTRIES) {
      // Keep recent + successful + user-liked entries
      const sorted = [...this.store.entries].sort((a, b) => {
        let scoreA = 0
        let scoreB = 0
        if (a.userFeedback === "positive") scoreA += 100
        if (b.userFeedback === "positive") scoreB += 100
        if (a.success) scoreA += 10
        if (b.success) scoreB += 10
        scoreA += a.timestamp / 1e10
        scoreB += b.timestamp / 1e10
        return scoreB - scoreA
      })
      this.store.entries = sorted.slice(0, MAX_ENTRIES)
    }
  }
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s
}
