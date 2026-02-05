import type { AgentProvider, GenerationMessage } from "../providers/types"
import type { TechStack } from "../context/tech-stack"
import { formatTechStack } from "../context/tech-stack"
import { generateSkillMd } from "./registry"
import type { Skill } from "./types"

// --- Generate new skills using AI ---

export async function generateSkill(
  provider: AgentProvider,
  name: string,
  description: string,
  techStack: TechStack,
  options?: { tags?: string[]; outputType?: string }
): Promise<{ skill: Skill; content: string }> {
  const systemPrompt = `You are a skill author for the Agent Skills ecosystem (skills.sh).
You create high-quality SKILL.md files that provide reusable instructions for AI coding agents.

A skill is a markdown document with YAML frontmatter that teaches an agent how to perform a specific task.
Skills should be:
- Clear and actionable
- Tech-stack aware (use the right patterns for the project)
- Complete but concise
- Include examples where helpful
- Follow the Agent Skills specification

The project's tech stack:
${formatTechStack(techStack)}

Output ONLY the SKILL.md content (frontmatter + markdown instructions). Do not wrap in code fences.`

  const messages: GenerationMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Create a skill called "${name}" with this description: "${description}"${
        options?.tags?.length ? `\nTags: ${options.tags.join(", ")}` : ""
      }${options?.outputType ? `\nPrimary output type: ${options.outputType}` : ""}

The skill should contain detailed instructions for an AI agent to follow when performing this task in a project with the above tech stack. Include:
1. Step-by-step instructions
2. Code patterns and conventions to follow
3. Common pitfalls to avoid
4. Examples where helpful`,
    },
  ]

  const result = await provider.generate(messages, {
    temperature: 0.7,
    maxTokens: 4096,
  })

  const skillContent = result.content.trim()

  // Parse the generated content
  const skill: Skill = {
    frontmatter: { name, description },
    instructions: skillContent,
    source: "generated",
  }

  // Try to parse the frontmatter from generated content
  const frontmatterMatch = skillContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (frontmatterMatch) {
    skill.instructions = frontmatterMatch[2].trim()
  }

  return { skill, content: skillContent }
}
