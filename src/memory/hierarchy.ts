// --- Memory Hierarchy: user-level + project-level layered memory ---

import os from "os"
import { Memory, type UserPreference, type MemoryEntry, type LearnedPattern, type MemoryStore } from "@/src/runtime/memory"

const USER_MEMORY_DIR = os.homedir()

export class MemoryHierarchy {
  private userMemory: Memory
  private projectMemory: Memory

  constructor(private cwd: string) {
    // User-level memory at ~/.shadxn/memory.json
    this.userMemory = new Memory(USER_MEMORY_DIR)
    // Project-level memory at <cwd>/.shadxn/memory.json
    this.projectMemory = new Memory(cwd)
  }

  async load(): Promise<void> {
    await Promise.all([this.userMemory.load(), this.projectMemory.load()])
  }

  async save(): Promise<void> {
    await Promise.all([this.userMemory.save(), this.projectMemory.save()])
  }

  /**
   * Build merged memory context for the agent. Project overrides user.
   */
  buildMemoryContext(task: string): string {
    const userCtx = this.userMemory.buildMemoryContext(task)
    const projectCtx = this.projectMemory.buildMemoryContext(task)

    if (!userCtx && !projectCtx) return ""

    const sections: string[] = []
    if (projectCtx) {
      sections.push(projectCtx)
    }
    if (userCtx) {
      // Prefix user-level context to distinguish it
      sections.push(
        userCtx.replace(
          "# Memory (learned from past interactions)",
          "# Global Memory (cross-project patterns)"
        )
      )
    }

    return sections.join("\n\n")
  }

  /**
   * Learn a preference at user level (global).
   */
  async learnPreference(key: string, value: string, source: string): Promise<void> {
    await this.userMemory.learnPreference(key, value, source)
  }

  /**
   * Record a generation at project level (task-specific).
   */
  async recordGeneration(
    entry: Omit<MemoryEntry, "id" | "timestamp" | "type">
  ): Promise<string> {
    return this.projectMemory.recordGeneration(entry)
  }

  /**
   * Get combined preferences (project overrides user for same keys).
   */
  getPreferences(): UserPreference[] {
    const userPrefs = this.userMemory.getPreferences()
    const projectPrefs = this.projectMemory.getPreferences()

    const merged = new Map<string, UserPreference>()
    for (const p of userPrefs) {
      merged.set(p.key, p)
    }
    for (const p of projectPrefs) {
      merged.set(p.key, p) // project overrides
    }
    return Array.from(merged.values())
  }

  /**
   * Get combined patterns from both levels.
   */
  getPatterns(): LearnedPattern[] {
    const userPatterns = this.userMemory.getPatterns()
    const projectPatterns = this.projectMemory.getPatterns()
    return [...projectPatterns, ...userPatterns]
  }

  /**
   * Get stats from both levels.
   */
  getStats(): { user: MemoryStore["stats"]; project: MemoryStore["stats"] } {
    return {
      user: this.userMemory.getStats(),
      project: this.projectMemory.getStats(),
    }
  }

  /**
   * Get recent generations from project level.
   */
  getRecentGenerations(limit = 10): MemoryEntry[] {
    return this.projectMemory.getRecentGenerations(limit)
  }
}
