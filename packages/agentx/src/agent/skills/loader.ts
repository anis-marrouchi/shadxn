import { existsSync, promises as fs } from "fs"
import path from "path"
import fg from "fast-glob"
import { logger } from "@/utils/logger"
import type { Skill, SkillFrontmatter, SkillMatch } from "./types"
import { skillFrontmatterSchema } from "./types"

// --- Load skills from local files and remote packages ---

const SKILL_DIRS = [".skills", ".claude/skills", "skills"]
const SKILL_FILE = "SKILL.md"

export async function loadLocalSkills(cwd: string): Promise<Skill[]> {
  const skills: Skill[] = []

  for (const dir of SKILL_DIRS) {
    const skillDir = path.resolve(cwd, dir)
    if (!existsSync(skillDir)) continue

    const skillFiles = await fg.glob(`**/${SKILL_FILE}`, {
      cwd: skillDir,
      deep: 3,
    })

    for (const file of skillFiles) {
      const fullPath = path.resolve(skillDir, file)
      const skill = await parseSkillFile(fullPath)
      if (skill) {
        skill.source = "local"
        skill.path = fullPath
        skills.push(skill)
      }
    }
  }

  // Also check for a single SKILL.md at project root
  const rootSkill = path.resolve(cwd, SKILL_FILE)
  if (existsSync(rootSkill)) {
    const skill = await parseSkillFile(rootSkill)
    if (skill) {
      skill.source = "local"
      skill.path = rootSkill
      skills.push(skill)
    }
  }

  return skills
}

export async function parseSkillFile(filePath: string): Promise<Skill | null> {
  try {
    const content = await fs.readFile(filePath, "utf8")
    return parseSkillContent(content)
  } catch {
    return null
  }
}

export function parseSkillContent(content: string): Skill | null {
  try {
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

    if (!frontmatterMatch) {
      // No frontmatter - treat entire content as instructions with minimal metadata
      return {
        frontmatter: { name: "unnamed", description: "No description" },
        instructions: content.trim(),
        source: "local",
      }
    }

    const [, frontmatterRaw, instructions] = frontmatterMatch
    const frontmatter = parseYamlFrontmatter(frontmatterRaw)

    const validated = skillFrontmatterSchema.parse(frontmatter)

    return {
      frontmatter: validated,
      instructions: instructions.trim(),
      source: "local",
    }
  } catch {
    return null
  }
}

function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = raw.split("\n")

  let currentKey = ""
  let inArray = false
  let arrayValues: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Array item
    if (trimmed.startsWith("- ") && inArray) {
      arrayValues.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""))
      continue
    }

    // Save previous array if we were in one
    if (inArray && currentKey) {
      result[currentKey] = arrayValues
      inArray = false
      arrayValues = []
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w+)\s*:\s*(.*)$/)
    if (kvMatch) {
      const [, key, value] = kvMatch
      currentKey = key

      if (value.trim() === "") {
        // Could be start of an array or nested object
        inArray = true
        arrayValues = []
      } else {
        // Simple value
        result[key] = value.trim().replace(/^["']|["']$/g, "")
      }
    }
  }

  // Save last array if any
  if (inArray && currentKey) {
    result[currentKey] = arrayValues
  }

  return result
}

export function matchSkillsToTask(
  skills: Skill[],
  taskDescription: string,
  outputType?: string
): SkillMatch[] {
  const matches: SkillMatch[] = []
  const taskLower = taskDescription.toLowerCase()
  const taskWords = new Set(taskLower.split(/\s+/))

  for (const skill of skills) {
    let relevance = 0
    let matchReason = ""

    // Check trigger patterns
    if (skill.frontmatter.triggers) {
      for (const trigger of skill.frontmatter.triggers) {
        try {
          const regex = new RegExp(trigger.pattern, "i")
          if (regex.test(taskDescription)) {
            relevance = Math.max(relevance, 0.9)
            matchReason = `Trigger match: ${trigger.description || trigger.pattern}`
          }
        } catch {
          // Invalid regex - try simple string match
          if (taskLower.includes(trigger.pattern.toLowerCase())) {
            relevance = Math.max(relevance, 0.7)
            matchReason = `Keyword match: ${trigger.pattern}`
          }
        }
      }
    }

    // Check tags overlap
    if (skill.frontmatter.tags) {
      const tagOverlap = skill.frontmatter.tags.filter(
        (tag) => taskWords.has(tag.toLowerCase()) || taskLower.includes(tag.toLowerCase())
      )
      if (tagOverlap.length) {
        const tagRelevance = Math.min(tagOverlap.length * 0.3, 0.8)
        if (tagRelevance > relevance) {
          relevance = tagRelevance
          matchReason = `Tag match: ${tagOverlap.join(", ")}`
        }
      }
    }

    // Check name/description overlap
    const nameWords = skill.frontmatter.name.toLowerCase().split(/[-_\s]+/)
    const descWords = skill.frontmatter.description.toLowerCase().split(/\s+/)
    const allSkillWords = new Set([...nameWords, ...descWords])

    const overlap = [...taskWords].filter((w) => allSkillWords.has(w) && w.length > 3)
    if (overlap.length > 0) {
      const wordRelevance = Math.min(overlap.length * 0.2, 0.6)
      if (wordRelevance > relevance) {
        relevance = wordRelevance
        matchReason = `Content match: ${overlap.join(", ")}`
      }
    }

    if (relevance > 0.1) {
      matches.push({ skill, relevance, matchReason })
    }
  }

  return matches.sort((a, b) => b.relevance - a.relevance)
}
