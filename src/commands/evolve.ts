import { existsSync, promises as fs } from "fs"
import path from "path"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { createAgentContext } from "@/src/agent"
import { createProvider, type ProviderName } from "@/src/agent/providers"
import { ensureCredentials } from "@/src/commands/model"
import type { GenerationMessage, GeneratedFile } from "@/src/agent/providers/types"
import { formatTechStack } from "@/src/agent/context/tech-stack"
import { formatSchemas } from "@/src/agent/context/schema"
import { matchSkillsToTask } from "@/src/agent/skills/loader"
import chalk from "chalk"
import { Command } from "commander"
import ora from "ora"
import prompts from "prompts"
import fg from "fast-glob"

// --- `shadxn evolve` — modify existing code with AI ---

interface FileChange {
  path: string
  original: string
  proposed: string
  description?: string
}

export const evolve = new Command()
  .name("evolve")
  .aliases(["ev", "transform"])
  .description("modify existing code using AI — add features, refactor, migrate patterns")
  .argument("[task...]", "describe the transformation to apply")
  .option(
    "-g, --glob <pattern>",
    "glob pattern for files to evolve (e.g., src/components/**/*.tsx)"
  )
  .option(
    "--max-files <n>",
    "maximum number of files to process",
    "10"
  )
  .option(
    "-p, --provider <provider>",
    "AI provider (claude-code, claude)",
    "claude-code"
  )
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .option("--no-context7", "disable Context7 doc lookup")
  .option("-y, --yes", "apply all changes without confirmation", false)
  .option("--dry-run", "show proposed changes without writing", false)
  .action(async (taskParts, opts) => {
    try {
      let task = taskParts?.length ? taskParts.join(" ") : undefined
      const cwd = path.resolve(opts.cwd)

      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist.`)
        process.exit(1)
      }

      // Interactive task input
      if (!task) {
        const response = await prompts({
          type: "text",
          name: "task",
          message: "Describe the transformation to apply:",
          validate: (v) => (v.trim() ? true : "Please describe the transformation"),
        })
        if (!response.task) {
          logger.warn("No task provided. Exiting.")
          process.exit(0)
        }
        task = response.task
      }

      // Get glob pattern
      let globPattern = opts.glob
      if (!globPattern) {
        const response = await prompts({
          type: "text",
          name: "glob",
          message: "File pattern to evolve (glob):",
          initial: "src/**/*.{ts,tsx,js,jsx}",
          validate: (v) => (v.trim() ? true : "Pattern is required"),
        })
        if (!response.glob) {
          logger.warn("No pattern provided. Exiting.")
          process.exit(0)
        }
        globPattern = response.glob
      }

      // Find matching files
      const matchedFiles = await fg.glob(globPattern, {
        cwd,
        ignore: [
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
          "**/.next/**",
          "**/target/**",
          "**/.git/**",
        ],
        onlyFiles: true,
      })

      const maxFiles = parseInt(opts.maxFiles, 10)
      if (!matchedFiles.length) {
        logger.warn(`No files matched pattern: ${globPattern}`)
        process.exit(0)
      }

      const filesToProcess = matchedFiles.slice(0, maxFiles)
      if (matchedFiles.length > maxFiles) {
        logger.warn(
          `Found ${matchedFiles.length} files, processing first ${maxFiles}. Use --max-files to increase.`
        )
      }

      logger.break()
      logger.info(`Task: ${chalk.bold(task)}`)
      logger.info(`Files: ${chalk.bold(String(filesToProcess.length))} matching ${chalk.dim(globPattern)}`)
      logger.break()

      // Read all target files
      const spinner = ora("Reading files and analyzing project...").start()

      const fileContents: { path: string; content: string }[] = []
      for (const file of filesToProcess) {
        const fullPath = path.resolve(cwd, file)
        const content = await fs.readFile(fullPath, "utf8")
        fileContents.push({ path: file, content })
      }

      // Gather agent context
      const context = await createAgentContext(cwd, task!, {
        provider: opts.provider,
        context7: { enabled: opts.context7 !== false },
      })

      // Match skills
      const matchedSkills = matchSkillsToTask(context.skills, task!, undefined)

      spinner.text = "Generating transformations..."

      // Build the evolve prompt
      const systemPrompt = buildEvolveSystemPrompt(context, matchedSkills.map((m) => m.skill))

      const filesSummary = fileContents
        .map(
          (f) =>
            `## File: ${f.path}\n\`\`\`\n${truncate(f.content, 4000)}\n\`\`\``
        )
        .join("\n\n")

      const userMessage = `# Transformation Task
${task}

# Files to Transform
${filesSummary}

Transform these files according to the task. For each file that needs changes, use \`create_files\` with the complete updated file content. Only include files that actually need changes — skip files that don't need modification.`

      // Ensure credentials exist (auto-prompt if missing)
      const hasCredentials = await ensureCredentials(opts.apiKey)
      if (!hasCredentials) {
        logger.error("No credentials configured. Run `shadxn model` to set up.")
        process.exit(1)
      }

      // Generate with provider
      const provider = createProvider(opts.provider as ProviderName, opts.apiKey)
      const messages: GenerationMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ]

      const result = await provider.generate(messages, {
        model: opts.model,
        maxTokens: 16384,
      })

      spinner.stop()

      // Handle follow-up questions
      if (result.followUp) {
        logger.break()
        logger.info(chalk.yellow("The agent needs more information:"))
        logger.break()
        console.log(result.followUp)
        logger.break()
        return
      }

      if (!result.files.length) {
        logger.info("No changes proposed.")
        if (result.content) {
          logger.break()
          console.log(result.content)
        }
        return
      }

      // Build change set with diffs
      const changes: FileChange[] = []
      for (const file of result.files) {
        const original = fileContents.find((f) => f.path === file.path)
        changes.push({
          path: file.path,
          original: original?.content || "",
          proposed: file.content,
          description: file.description,
        })
      }

      // Display changes with diff preview
      logger.break()
      console.log(
        chalk.bold(`  ${changes.length} file(s) with proposed changes:`)
      )
      logger.break()

      if (result.content) {
        console.log(chalk.dim(result.content))
        logger.break()
      }

      // Show diff for each file
      const approved: FileChange[] = []

      for (const change of changes) {
        console.log(chalk.bold.cyan(`  ${change.path}`))
        if (change.description) {
          console.log(chalk.dim(`  ${change.description}`))
        }
        logger.break()

        // Show a simplified diff
        const diffLines = generateSimpleDiff(change.original, change.proposed)
        for (const line of diffLines.slice(0, 40)) {
          if (line.startsWith("+")) {
            console.log(chalk.green(`    ${line}`))
          } else if (line.startsWith("-")) {
            console.log(chalk.red(`    ${line}`))
          } else {
            console.log(chalk.dim(`    ${line}`))
          }
        }
        if (diffLines.length > 40) {
          console.log(chalk.dim(`    ... ${diffLines.length - 40} more lines`))
        }
        logger.break()

        if (opts.yes || opts.dryRun) {
          approved.push(change)
        } else {
          const { action } = await prompts({
            type: "select",
            name: "action",
            message: `${change.path}`,
            choices: [
              { title: "Accept", value: "accept" },
              { title: "Skip", value: "skip" },
              { title: "Accept all remaining", value: "accept-all" },
              { title: "Quit", value: "quit" },
            ],
          })

          if (action === "accept") {
            approved.push(change)
          } else if (action === "accept-all") {
            approved.push(change)
            // Accept all remaining
            const remaining = changes.slice(changes.indexOf(change) + 1)
            approved.push(...remaining)
            break
          } else if (action === "quit") {
            break
          }
          // "skip" just continues
        }
      }

      // Write approved changes
      if (!approved.length) {
        logger.info("No changes applied.")
        return
      }

      if (opts.dryRun) {
        logger.break()
        logger.success(`Dry run: ${approved.length} file(s) would be modified:`)
        for (const change of approved) {
          console.log(`  ${chalk.green("~")} ${change.path}`)
        }
        return
      }

      const writeSpinner = ora("Applying changes...").start()

      let written = 0
      let errors = 0
      for (const change of approved) {
        try {
          const fullPath = path.resolve(cwd, change.path)
          const dir = path.dirname(fullPath)
          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(fullPath, change.proposed, "utf8")
          written++
        } catch (error: any) {
          logger.error(`Failed to write ${change.path}: ${error.message}`)
          errors++
        }
      }

      writeSpinner.stop()

      logger.break()
      logger.success(`Applied ${written} change(s):`)
      for (const change of approved) {
        console.log(`  ${chalk.green("~")} ${change.path}`)
      }
      if (errors) {
        logger.error(`${errors} file(s) failed to write.`)
      }

      if (result.tokensUsed) {
        logger.break()
        logger.info(`Tokens used: ${result.tokensUsed}`)
      }
    } catch (error) {
      handleError(error)
    }
  })

function buildEvolveSystemPrompt(context: any, skills: any[]): string {
  const sections: string[] = []

  sections.push(`You are shadxn evolve, an agentic code transformation tool. You modify existing code according to user instructions.

Your primary tool is \`create_files\` — use it to output the COMPLETE updated content of each file that needs changes.
If the request is ambiguous, use \`ask_user\` to ask a clarifying question.

CRITICAL RULES:
- Output the FULL file content for each changed file (not just the diff)
- Keep the file path exactly as given — do not rename files unless explicitly asked
- Preserve existing code patterns, naming conventions, and style
- Only modify what's necessary for the transformation
- Do NOT remove unrelated code or comments
- Do NOT add unrelated features or "improvements"
- Include all existing imports — do not accidentally drop them
- If a file doesn't need changes, do NOT include it in the output`)

  sections.push(`# Project Tech Stack\n${formatTechStack(context.techStack)}`)

  const deps = Object.keys(context.techStack.dependencies).slice(0, 20)
  if (deps.length) {
    sections.push(`# Key Dependencies\n${deps.join(", ")}`)
  }

  const schemaStr = formatSchemas(context.schemas)
  if (schemaStr) {
    sections.push(`# Project Schemas\n${schemaStr}`)
  }

  if (skills.length) {
    sections.push(
      `# Active Skills\n` +
        skills
          .map(
            (s: any) =>
              `## ${s.frontmatter.name}\n${s.frontmatter.description}\n\n${s.instructions}`
          )
          .join("\n\n---\n\n")
    )
  }

  if (context.docs) {
    sections.push(context.docs)
  }

  return sections.join("\n\n")
}

function generateSimpleDiff(original: string, proposed: string): string[] {
  const origLines = original.split("\n")
  const propLines = proposed.split("\n")
  const diff: string[] = []

  // Simple line-by-line comparison
  const maxLen = Math.max(origLines.length, propLines.length)
  let contextBuffer: string[] = []
  let lastChangeIdx = -10

  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined
    const propLine = i < propLines.length ? propLines[i] : undefined

    if (origLine === propLine) {
      // Same line — keep as context near changes
      if (i - lastChangeIdx <= 2) {
        diff.push(` ${origLine}`)
      } else {
        contextBuffer.push(` ${origLine}`)
        // Only keep last 2 context lines
        if (contextBuffer.length > 2) {
          contextBuffer.shift()
        }
      }
    } else {
      // Add context buffer before this change
      if (i - lastChangeIdx > 3 && diff.length > 0) {
        diff.push("  ...")
      }
      diff.push(...contextBuffer)
      contextBuffer = []

      if (origLine !== undefined && propLine !== undefined) {
        diff.push(`-${origLine}`)
        diff.push(`+${propLine}`)
      } else if (origLine !== undefined) {
        diff.push(`-${origLine}`)
      } else if (propLine !== undefined) {
        diff.push(`+${propLine}`)
      }
      lastChangeIdx = i
    }
  }

  return diff
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + "\n// ... (truncated)"
}
