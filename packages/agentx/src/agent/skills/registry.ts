import { execa } from "execa"
import { existsSync, promises as fs } from "fs"
import path from "path"
import fetch from "node-fetch"
import { logger } from "@/utils/logger"
import type { Skill, SkillPackage } from "./types"
import { parseSkillContent } from "./loader"

// --- skills.sh integration: install, list, and search skills ---

const SKILLS_SH_API = "https://skills.sh"

export async function installSkillPackage(
  packageId: string,
  cwd: string
): Promise<Skill[]> {
  // packageId format: "owner/repo" or "owner/repo/skill-name"
  const parts = packageId.split("/")
  if (parts.length < 2) {
    throw new Error(`Invalid skill package ID: ${packageId}. Expected format: owner/repo`)
  }

  const owner = parts[0]
  const repo = parts[1]
  const specificSkill = parts[2] // optional

  // Try using npx skills add first (official CLI)
  try {
    const skillArg = specificSkill ? `${owner}/${repo}/${specificSkill}` : `${owner}/${repo}`
    await execa("npx", ["-y", "skills", "add", skillArg], {
      cwd,
      stdio: "pipe",
    })

    logger.success(`Installed skill package: ${packageId}`)

    // Load the installed skills
    const skillsDir = path.resolve(cwd, ".skills", `${owner}_${repo}`)
    if (existsSync(skillsDir)) {
      return await loadInstalledSkills(skillsDir, packageId)
    }

    // Also check the standard .skills directory structure
    const altDir = path.resolve(cwd, ".skills")
    if (existsSync(altDir)) {
      return await loadInstalledSkills(altDir, packageId)
    }

    return []
  } catch {
    // Fallback: fetch directly from GitHub
    logger.info(`Fetching skills directly from GitHub: ${owner}/${repo}`)
    return await fetchFromGitHub(owner, repo, specificSkill, cwd)
  }
}

async function fetchFromGitHub(
  owner: string,
  repo: string,
  specificSkill: string | undefined,
  cwd: string
): Promise<Skill[]> {
  const skills: Skill[] = []

  try {
    // Fetch repo tree to find SKILL.md files
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`
    const response = await fetch(treeUrl)

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = (await response.json()) as { tree: { path: string; type: string }[] }
    const skillFiles = data.tree.filter(
      (item) => item.type === "blob" && item.path.endsWith("SKILL.md")
    )

    if (specificSkill) {
      const specific = skillFiles.find(
        (f) =>
          f.path.includes(`/${specificSkill}/`) || f.path === `${specificSkill}/SKILL.md`
      )
      if (specific) {
        const skill = await fetchAndSaveSkill(owner, repo, specific.path, cwd)
        if (skill) skills.push(skill)
      }
    } else {
      for (const file of skillFiles) {
        const skill = await fetchAndSaveSkill(owner, repo, file.path, cwd)
        if (skill) skills.push(skill)
      }
    }
  } catch (error: any) {
    logger.error(`Failed to fetch skills from GitHub: ${error.message}`)
  }

  return skills
}

async function fetchAndSaveSkill(
  owner: string,
  repo: string,
  filePath: string,
  cwd: string
): Promise<Skill | null> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${filePath}`
    const response = await fetch(rawUrl)

    if (!response.ok) return null

    const content = await response.text()
    const skill = parseSkillContent(content)

    if (skill) {
      skill.source = "remote"
      skill.packageId = `${owner}/${repo}`

      // Save locally
      const skillDir = path.dirname(filePath)
      const localDir = path.resolve(cwd, ".skills", `${owner}_${repo}`, skillDir)
      await fs.mkdir(localDir, { recursive: true })
      await fs.writeFile(path.resolve(localDir, "SKILL.md"), content)
      skill.path = path.resolve(localDir, "SKILL.md")
    }

    return skill
  } catch {
    return null
  }
}

async function loadInstalledSkills(dir: string, packageId: string): Promise<Skill[]> {
  const skills: Skill[] = []
  const { default: fg } = await import("fast-glob")

  const skillFiles = await fg.glob("**/SKILL.md", {
    cwd: dir,
    deep: 5,
  })

  for (const file of skillFiles) {
    try {
      const fullPath = path.resolve(dir, file)
      const content = await fs.readFile(fullPath, "utf8")
      const skill = parseSkillContent(content)
      if (skill) {
        skill.source = "remote"
        skill.path = fullPath
        skill.packageId = packageId
        skills.push(skill)
      }
    } catch {
      // Skip broken skill files
    }
  }

  return skills
}

export async function generateSkillMd(
  name: string,
  description: string,
  instructions: string,
  tags?: string[],
  globs?: string[]
): Promise<string> {
  const frontmatter: string[] = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
  ]

  if (tags?.length) {
    frontmatter.push("tags:")
    for (const tag of tags) {
      frontmatter.push(`  - ${tag}`)
    }
  }

  if (globs?.length) {
    frontmatter.push("globs:")
    for (const glob of globs) {
      frontmatter.push(`  - ${glob}`)
    }
  }

  frontmatter.push("---")

  return `${frontmatter.join("\n")}\n\n${instructions}`
}

export async function listInstalledSkills(cwd: string): Promise<Skill[]> {
  const { loadLocalSkills } = await import("./loader")
  return loadLocalSkills(cwd)
}
