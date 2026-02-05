import { existsSync } from "fs"
import path from "path"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { createAgentContext } from "@/src/agent"
import { formatTechStack } from "@/src/agent/context/tech-stack"
import { formatSchemas } from "@/src/agent/context/schema"
import { loadLocalSkills } from "@/src/agent/skills/loader"
import chalk from "chalk"
import { Command } from "commander"
import ora from "ora"

// --- `shadxn inspect` — show what the agent sees ---

export const inspect = new Command()
  .name("inspect")
  .aliases(["info", "ctx"])
  .description("show what the agent knows about your project — tech stack, schemas, skills, and more")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .option("--json", "output as JSON", false)
  .option("--verbose", "show full schema and model contents", false)
  .action(async (opts) => {
    try {
      const cwd = path.resolve(opts.cwd)
      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist.`)
        process.exit(1)
      }

      const spinner = ora("Analyzing project...").start()

      const context = await createAgentContext(cwd, "inspect", {
        context7: { enabled: false },
      })

      spinner.stop()

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              techStack: context.techStack,
              schemas: context.schemas,
              skills: context.skills.map((s) => ({
                name: s.frontmatter.name,
                description: s.frontmatter.description,
                source: s.source,
                tags: s.frontmatter.tags,
              })),
            },
            null,
            2
          )
        )
        return
      }

      // Header
      logger.break()
      console.log(chalk.bold.cyan("  shadxn inspect"))
      console.log(chalk.dim(`  ${cwd}`))
      logger.break()

      // Languages
      const { techStack } = context
      if (techStack.languages.length) {
        console.log(chalk.bold("  Languages"))
        for (const lang of techStack.languages) {
          console.log(
            `    ${chalk.green("●")} ${lang.name}${lang.version ? chalk.dim(` ${lang.version}`) : ""}${lang.configFile ? chalk.dim(` (${lang.configFile})`) : ""}`
          )
        }
        logger.break()
      }

      // Frameworks
      if (techStack.frameworks.length) {
        console.log(chalk.bold("  Frameworks"))
        for (const fw of techStack.frameworks) {
          const typeColor =
            fw.type === "frontend"
              ? chalk.blue
              : fw.type === "backend"
                ? chalk.yellow
                : fw.type === "fullstack"
                  ? chalk.magenta
                  : fw.type === "mobile"
                    ? chalk.green
                    : chalk.dim
          console.log(
            `    ${chalk.green("●")} ${fw.name}${fw.version ? chalk.dim(` @${fw.version}`) : ""} ${typeColor(`[${fw.type}]`)}`
          )
        }
        logger.break()
      }

      // Package manager
      if (techStack.packageManager) {
        console.log(chalk.bold("  Package Manager"))
        console.log(`    ${chalk.green("●")} ${techStack.packageManager}`)
        logger.break()
      }

      // Databases
      if (techStack.databases.length) {
        console.log(chalk.bold("  Databases"))
        for (const db of techStack.databases) {
          console.log(`    ${chalk.green("●")} ${db}`)
        }
        logger.break()
      }

      // Styling
      if (techStack.styling.length) {
        console.log(chalk.bold("  Styling"))
        for (const style of techStack.styling) {
          console.log(`    ${chalk.green("●")} ${style}`)
        }
        logger.break()
      }

      // Testing
      if (techStack.testing.length) {
        console.log(chalk.bold("  Testing"))
        for (const test of techStack.testing) {
          console.log(`    ${chalk.green("●")} ${test}`)
        }
        logger.break()
      }

      // Deployment
      if (techStack.deployment.length) {
        console.log(chalk.bold("  Deployment"))
        for (const dep of techStack.deployment) {
          console.log(`    ${chalk.green("●")} ${dep}`)
        }
        logger.break()
      }

      // Monorepo
      if (techStack.monorepo) {
        console.log(chalk.bold("  Monorepo"))
        console.log(`    ${chalk.green("●")} yes`)
        logger.break()
      }

      // Schemas
      const { schemas } = context
      const hasSchemas =
        schemas.database || schemas.api || schemas.env || schemas.models?.length

      if (hasSchemas) {
        console.log(chalk.bold("  Schemas Detected"))

        if (schemas.database) {
          console.log(
            `    ${chalk.green("●")} Database: ${chalk.cyan(schemas.database.type)}${
              schemas.database.tables?.length
                ? chalk.dim(` (${schemas.database.tables.length} tables: ${schemas.database.tables.slice(0, 5).join(", ")}${schemas.database.tables.length > 5 ? "..." : ""})`)
                : ""
            }`
          )
          if (opts.verbose && schemas.database.content) {
            console.log(chalk.dim("    ┌─────────────────────"))
            for (const line of schemas.database.content.split("\n").slice(0, 20)) {
              console.log(chalk.dim(`    │ ${line}`))
            }
            console.log(chalk.dim("    └─────────────────────"))
          }
        }

        if (schemas.api) {
          console.log(`    ${chalk.green("●")} API: ${chalk.cyan(schemas.api.type)}`)
        }

        if (schemas.env) {
          console.log(
            `    ${chalk.green("●")} Environment: ${chalk.cyan(`${schemas.env.variables.length} variables`)}${
              schemas.env.variables.filter((v) => v.required).length
                ? chalk.dim(` (${schemas.env.variables.filter((v) => v.required).length} required)`)
                : ""
            }`
          )
        }

        if (schemas.models?.length) {
          console.log(
            `    ${chalk.green("●")} Models: ${chalk.cyan(`${schemas.models.length} file(s)`)} ${chalk.dim(schemas.models.map((m) => m.path).join(", "))}`
          )
        }

        logger.break()
      }

      // Skills
      if (context.skills.length) {
        console.log(chalk.bold("  Skills"))
        for (const s of context.skills) {
          const source =
            s.source === "remote"
              ? chalk.blue(`[${s.packageId || "remote"}]`)
              : s.source === "generated"
                ? chalk.magenta("[generated]")
                : chalk.dim("[local]")

          console.log(`    ${chalk.green("●")} ${s.frontmatter.name} ${source}`)
          console.log(`      ${chalk.dim(s.frontmatter.description)}`)
        }
        logger.break()
      } else {
        console.log(chalk.bold("  Skills"))
        console.log(
          `    ${chalk.dim("none installed")} — run ${chalk.green("shadxn skill install <owner/repo>")} or ${chalk.green("shadxn skill create <name>")}`
        )
        logger.break()
      }

      // Dependencies summary
      const depCount = Object.keys(techStack.dependencies).length
      const devDepCount = Object.keys(techStack.devDependencies).length
      if (depCount || devDepCount) {
        console.log(chalk.bold("  Dependencies"))
        console.log(
          `    ${chalk.green("●")} ${depCount} dependencies, ${devDepCount} devDependencies`
        )
        if (opts.verbose) {
          const topDeps = Object.entries(techStack.dependencies).slice(0, 15)
          for (const [name, version] of topDeps) {
            console.log(`      ${chalk.dim(name)} ${chalk.dim(version)}`)
          }
          if (depCount > 15) {
            console.log(chalk.dim(`      ... and ${depCount - 15} more`))
          }
        }
        logger.break()
      }

      // Summary line
      const parts: string[] = []
      if (techStack.languages.length) parts.push(`${techStack.languages.length} lang(s)`)
      if (techStack.frameworks.length) parts.push(`${techStack.frameworks.length} framework(s)`)
      if (hasSchemas) parts.push("schemas detected")
      if (context.skills.length) parts.push(`${context.skills.length} skill(s)`)
      console.log(chalk.dim(`  Summary: ${parts.join(" · ")}`))
      logger.break()
    } catch (error) {
      handleError(error)
    }
  })
