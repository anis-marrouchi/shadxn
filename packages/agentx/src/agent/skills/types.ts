import { z } from "zod"

// --- Skill types aligned with skills.sh / Agent Skills spec ---

export const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  globs: z.array(z.string()).optional(),
  // When to automatically apply this skill
  triggers: z
    .array(
      z.object({
        pattern: z.string(), // regex or keyword pattern
        description: z.string().optional(),
      })
    )
    .optional(),
})

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>

export interface Skill {
  frontmatter: SkillFrontmatter
  instructions: string // Markdown body
  source: "local" | "remote" | "generated"
  path?: string // Local file path
  packageId?: string // e.g., "intellectronica/agent-skills"
}

export interface SkillMatch {
  skill: Skill
  relevance: number // 0-1 how relevant to current task
  matchReason: string
}

export interface SkillPackage {
  owner: string
  repo: string
  skills: Skill[]
}
