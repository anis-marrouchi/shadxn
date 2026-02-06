import { existsSync, promises as fs } from "fs"
import path from "path"
import { createProvider, type ProviderName } from "@/src/agent/providers"
import type { GenerationMessage } from "@/src/agent/providers/types"
import { detectTechStack, formatTechStack } from "@/src/agent/context/tech-stack"
import { Memory, type MemoryEntry, type LearnedPattern } from "./memory"
import { generateSkillMd } from "@/src/agent/skills/registry"

// --- Self-Enhancement: auto-create skills from successful patterns ---
// After enough successful generations with positive feedback,
// the system distills what worked into reusable skills.
// It also detects degradation and triggers skill upgrades.

export interface EnhanceConfig {
  enabled: boolean
  autoSkills: boolean // Auto-create skills from patterns
  minFrequency: number // Min pattern frequency before creating a skill
  provider: ProviderName
  model?: string
  apiKey?: string
}

export interface EnhanceResult {
  skillsCreated: string[]
  skillsUpdated: string[]
  insights: string[]
}

const DEFAULT_CONFIG: EnhanceConfig = {
  enabled: true,
  autoSkills: true,
  minFrequency: 3,
  provider: "claude-code",
}

export class EnhanceEngine {
  private config: EnhanceConfig

  constructor(
    private cwd: string,
    private memory: Memory,
    config?: Partial<EnhanceConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async enhance(): Promise<EnhanceResult> {
    if (!this.config.enabled) {
      return { skillsCreated: [], skillsUpdated: [], insights: [] }
    }

    const result: EnhanceResult = {
      skillsCreated: [],
      skillsUpdated: [],
      insights: [],
    }

    // 1. Analyze patterns and create skills
    if (this.config.autoSkills) {
      const newSkills = await this.createSkillsFromPatterns()
      result.skillsCreated.push(...newSkills)
    }

    // 2. Analyze failure patterns for insights
    const insights = this.analyzeFailures()
    result.insights.push(...insights)

    // 3. Detect preference patterns
    const prefInsights = this.analyzePreferences()
    result.insights.push(...prefInsights)

    return result
  }

  private async createSkillsFromPatterns(): Promise<string[]> {
    const patterns = this.memory.getPatterns()
    const eligiblePatterns = patterns.filter(
      (p) => p.frequency >= this.config.minFrequency
    )

    if (!eligiblePatterns.length) return []

    const created: string[] = []
    const skillsDir = path.resolve(this.cwd, ".skills", "_auto")

    for (const pattern of eligiblePatterns.slice(0, 3)) {
      const skillName = patternToSkillName(pattern)
      const skillPath = path.resolve(skillsDir, skillName, "SKILL.md")

      // Don't recreate existing skills
      if (existsSync(skillPath)) continue

      try {
        const content = await this.generateSkillFromPattern(pattern)
        if (content) {
          await fs.mkdir(path.dirname(skillPath), { recursive: true })
          await fs.writeFile(skillPath, content, "utf8")
          created.push(skillName)
        }
      } catch {
        // Skip failed skill generation
      }
    }

    return created
  }

  private async generateSkillFromPattern(pattern: LearnedPattern): Promise<string | null> {
    // Get examples of successful generations matching this pattern
    const recentSuccesses = this.memory
      .getRecentGenerations(20)
      .filter((e) => e.success && e.userFeedback !== "negative")
      .slice(0, 3)

    if (!recentSuccesses.length) return null

    const provider = createProvider(this.config.provider, this.config.apiKey)
    const techStack = await detectTechStack(this.cwd)

    const messages: GenerationMessage[] = [
      {
        role: "system",
        content: `You are a skill author. Create a SKILL.md file that captures a successful pattern.
Tech stack: ${formatTechStack(techStack)}
Output ONLY the SKILL.md content with YAML frontmatter. No code fences.`,
      },
      {
        role: "user",
        content: `Create a skill from this recurring pattern:

Pattern: ${pattern.description}
Frequency: used ${pattern.frequency} times
Tech stack: ${pattern.techStack.join(", ") || "general"}

Successful examples:
${recentSuccesses.map((e) => `- "${e.task}" → ${e.files.join(", ")}`).join("\n")}

Create a concise, reusable skill that captures what worked.`,
      },
    ]

    const result = await provider.generate(messages, {
      maxTokens: 2048,
      temperature: 0.7,
    })

    return result.content.trim() || null
  }

  private analyzeFailures(): string[] {
    const insights: string[] = []
    const failures = this.memory.getFailedGenerations(20)

    if (failures.length < 2) return insights

    // Group failures by error pattern
    const errorGroups = new Map<string, MemoryEntry[]>()
    for (const f of failures) {
      const key = (f.error || "unknown").split("\n")[0].slice(0, 80)
      const group = errorGroups.get(key) || []
      group.push(f)
      errorGroups.set(key, group)
    }

    for (const [error, entries] of errorGroups) {
      if (entries.length >= 2) {
        insights.push(
          `Recurring error (${entries.length}x): "${error}" — consider creating a skill to prevent this`
        )
      }
    }

    // Success rate trending down
    const stats = this.memory.getStats()
    if (stats.successRate < 0.7 && stats.totalGenerations > 5) {
      insights.push(
        `Success rate is ${(stats.successRate * 100).toFixed(0)}% — review recent failures and update skills`
      )
    }

    return insights
  }

  private analyzePreferences(): string[] {
    const insights: string[] = []
    const prefs = this.memory.getPreferences()

    const highConfidence = prefs.filter((p) => p.confidence > 0.8)
    if (highConfidence.length) {
      insights.push(
        `Strong preferences detected: ${highConfidence.map((p) => `${p.key}=${p.value}`).join(", ")}`
      )
    }

    return insights
  }
}

function patternToSkillName(pattern: LearnedPattern): string {
  return pattern.description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "")
}
