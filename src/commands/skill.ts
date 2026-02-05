import { existsSync, promises as fs } from "fs"
import path from "path"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { createProvider, type ProviderName } from "@/src/agent/providers"
import { detectTechStack, formatTechStack } from "@/src/agent/context/tech-stack"
import { loadLocalSkills } from "@/src/agent/skills/loader"
import { installSkillPackage, generateSkillMd, listInstalledSkills } from "@/src/agent/skills/registry"
import { generateSkill } from "@/src/agent/skills/generator"
import chalk from "chalk"
import { Command } from "commander"
import ora from "ora"
import prompts from "prompts"

export const skill = new Command()
  .name("skill")
  .description("manage agent skills — install, create, list, and generate")

// --- skill install ---
skill
  .command("install")
  .aliases(["add", "i"])
  .description("install a skill package from skills.sh or GitHub")
  .argument("<package>", "skill package (e.g., intellectronica/agent-skills)")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .action(async (packageId, opts) => {
    try {
      const cwd = path.resolve(opts.cwd)
      const spinner = ora(`Installing skill: ${packageId}`).start()

      const skills = await installSkillPackage(packageId, cwd)

      spinner.stop()

      if (skills.length) {
        logger.success(`Installed ${skills.length} skill(s):`)
        for (const s of skills) {
          console.log(
            `  ${chalk.green("+")} ${s.frontmatter.name} — ${s.frontmatter.description}`
          )
        }
      } else {
        logger.warn("No skills found in the package.")
      }
    } catch (error) {
      handleError(error)
    }
  })

// --- skill list ---
skill
  .command("list")
  .aliases(["ls"])
  .description("list installed skills")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .action(async (opts) => {
    try {
      const cwd = path.resolve(opts.cwd)
      const skills = await listInstalledSkills(cwd)

      if (!skills.length) {
        logger.info("No skills installed. Install one with:")
        console.log(
          `  ${chalk.green("shadxn skill install")} ${chalk.dim("<owner/repo>")}`
        )
        return
      }

      logger.info(`Found ${skills.length} skill(s):`)
      logger.break()

      for (const s of skills) {
        const source =
          s.source === "remote"
            ? chalk.blue(`[${s.packageId}]`)
            : s.source === "generated"
              ? chalk.magenta("[generated]")
              : chalk.dim("[local]")

        console.log(`  ${chalk.bold(s.frontmatter.name)} ${source}`)
        console.log(`    ${chalk.dim(s.frontmatter.description)}`)

        if (s.frontmatter.tags?.length) {
          console.log(
            `    ${chalk.dim("tags:")} ${s.frontmatter.tags.map((t) => chalk.cyan(t)).join(", ")}`
          )
        }

        if (s.path) {
          console.log(`    ${chalk.dim("path:")} ${s.path}`)
        }

        logger.break()
      }
    } catch (error) {
      handleError(error)
    }
  })

// --- skill create ---
skill
  .command("create")
  .description("create a new skill interactively or from a description")
  .argument("[name]", "skill name")
  .option("-d, --description <desc>", "skill description")
  .option("--tags <tags>", "comma-separated tags")
  .option(
    "-p, --provider <provider>",
    "AI provider for generation",
    "claude"
  )
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .option("--no-ai", "create a blank skill template without AI")
  .action(async (name, opts) => {
    try {
      const cwd = path.resolve(opts.cwd)

      // Interactive name input if not provided
      if (!name) {
        const response = await prompts({
          type: "text",
          name: "name",
          message: "Skill name:",
          validate: (v) =>
            v.trim()
              ? /^[a-z0-9-]+$/.test(v.trim())
                ? true
                : "Use lowercase letters, numbers, and hyphens only"
              : "Name is required",
        })
        if (!response.name) {
          logger.warn("No name provided. Exiting.")
          process.exit(0)
        }
        name = response.name
      }

      // Get description
      let description = opts.description
      if (!description) {
        const response = await prompts({
          type: "text",
          name: "description",
          message: "Skill description:",
          validate: (v) => (v.trim() ? true : "Description is required"),
        })
        if (!response.description) {
          logger.warn("No description provided. Exiting.")
          process.exit(0)
        }
        description = response.description
      }

      const tags = opts.tags
        ? opts.tags.split(",").map((t: string) => t.trim())
        : undefined

      const skillDir = path.resolve(cwd, ".skills", name)
      const skillPath = path.resolve(skillDir, "SKILL.md")

      if (existsSync(skillPath)) {
        const { overwrite } = await prompts({
          type: "confirm",
          name: "overwrite",
          message: `Skill "${name}" already exists. Overwrite?`,
          initial: false,
        })
        if (!overwrite) {
          logger.info("Skipped.")
          return
        }
      }

      let content: string

      if (opts.ai === false) {
        // Blank template
        content = await generateSkillMd(
          name,
          description,
          `# ${name}\n\n## Instructions\n\nAdd your skill instructions here.\n\n## Examples\n\nAdd examples here.`,
          tags
        )
      } else {
        // AI-generated skill
        const spinner = ora("Detecting tech stack...").start()
        const techStack = await detectTechStack(cwd)
        spinner.text = "Generating skill with AI..."

        const provider = createProvider(
          opts.provider as ProviderName,
          opts.apiKey
        )

        const result = await generateSkill(
          provider,
          name,
          description,
          techStack,
          { tags }
        )

        spinner.stop()
        content = result.content
      }

      // Write skill file
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(skillPath, content, "utf8")

      logger.success(`Created skill: ${skillPath}`)
      logger.break()
      logger.info("The skill will be automatically loaded for future generations.")
      logger.info(
        `To share it, push to GitHub and others can install with: ${chalk.green(`shadxn skill install <your-username>/<your-repo>`)}`
      )
    } catch (error) {
      handleError(error)
    }
  })

// --- skill inspect ---
skill
  .command("inspect")
  .description("show details of an installed skill")
  .argument("<name>", "skill name")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .action(async (name, opts) => {
    try {
      const cwd = path.resolve(opts.cwd)
      const skills = await listInstalledSkills(cwd)

      const found = skills.find(
        (s) => s.frontmatter.name === name || s.path?.includes(name)
      )

      if (!found) {
        logger.error(`Skill "${name}" not found.`)
        logger.info(`Run ${chalk.green("shadxn skill list")} to see installed skills.`)
        return
      }

      console.log(chalk.bold(`\n  ${found.frontmatter.name}`))
      console.log(`  ${found.frontmatter.description}`)
      logger.break()

      if (found.frontmatter.tags?.length) {
        console.log(
          `  ${chalk.dim("Tags:")} ${found.frontmatter.tags.join(", ")}`
        )
      }
      if (found.packageId) {
        console.log(`  ${chalk.dim("Package:")} ${found.packageId}`)
      }
      if (found.path) {
        console.log(`  ${chalk.dim("Path:")} ${found.path}`)
      }

      logger.break()
      console.log(chalk.dim("  --- Instructions ---"))
      logger.break()
      console.log(
        found.instructions
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      )
      logger.break()
    } catch (error) {
      handleError(error)
    }
  })
