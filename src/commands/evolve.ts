import { existsSync, promises as fs } from "fs"
import path from "path"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { createAgentContext } from "@/src/agent"
import { createProvider, type ProviderName } from "@/src/agent/providers"
import { ensureCredentials } from "@/src/utils/auth-store"
import { loadAuthConfig } from "@/src/utils/auth-store"
import type { GenerationMessage, GeneratedFile } from "@/src/agent/providers/types"
import { formatTechStack } from "@/src/agent/context/tech-stack"
import { formatSchemas } from "@/src/agent/context/schema"
import { matchSkillsToTask } from "@/src/agent/skills/loader"
import { globalHooks } from "@/src/hooks"
import { globalPermissions, type PermissionMode } from "@/src/permissions"
import { globalTracker, debug, setDebug } from "@/src/observability"
import { MemoryHierarchy } from "@/src/memory"
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
  .option("--debug", "enable debug mode with verbose logging", false)
  .option("--mode <mode>", "permission mode (default, acceptEdits, plan, yolo)")
  .option("--heal", "verify generated code and auto-fix errors")
  .option("--no-heal", "skip verification after applying changes")
  .option("--test-cmd <cmd>", "test command for heal verification")
  .option("--build-cmd <cmd>", "build command for heal verification")
  .action(async (taskParts, opts) => {
    try {
      let task = taskParts?.length ? taskParts.join(" ") : undefined
      const cwd = path.resolve(opts.cwd)

      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist.`)
        process.exit(1)
      }

      // Debug/mode init
      if (opts.debug) {
        setDebug(true)
      }
      if (opts.mode) {
        globalPermissions.setMode(opts.mode as PermissionMode)
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

      // pre:prompt hook — can modify or block the task
      let effectiveTask = task!
      if (globalHooks.has("pre:prompt")) {
        const promptResult = await globalHooks.execute("pre:prompt", {
          event: "pre:prompt",
          task: effectiveTask,
          cwd,
        })
        if (promptResult.blocked) {
          logger.error(promptResult.message || "Blocked by pre:prompt hook")
          process.exit(1)
        }
        if (promptResult.modified?.task) {
          effectiveTask = String(promptResult.modified.task)
        }
      }

      // pre:generate hook — can block the entire generation
      if (globalHooks.has("pre:generate")) {
        const genResult = await globalHooks.execute("pre:generate", {
          event: "pre:generate",
          task: effectiveTask,
          cwd,
        })
        if (genResult.blocked) {
          logger.error(genResult.message || "Blocked by pre:generate hook")
          process.exit(1)
        }
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
      logger.info(`Task: ${chalk.bold(effectiveTask)}`)
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
      const context = await createAgentContext(cwd, effectiveTask, {
        provider: opts.provider,
        context7: { enabled: opts.context7 !== false },
      })

      // Match skills
      const matchedSkills = matchSkillsToTask(context.skills, effectiveTask, undefined)
      if (matchedSkills.length) {
        debug.context("skills", `${matchedSkills.length} matched for evolve`)
      }

      spinner.text = "Generating transformations..."

      // Build the evolve prompt (now includes memory and project instructions)
      const systemPrompt = buildEvolveSystemPrompt(context, matchedSkills.map((m) => m.skill))

      const filesSummary = fileContents
        .map(
          (f) =>
            `## File: ${f.path}\n\`\`\`\n${truncate(f.content, 4000)}\n\`\`\``
        )
        .join("\n\n")

      const userMessage = `# Transformation Task
${effectiveTask}

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
      const providerName = opts.provider as ProviderName
      const provider = createProvider(providerName, opts.apiKey)
      const resolvedModel = opts.model || loadAuthConfig()?.model
      const messages: GenerationMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ]

      debug.step(1, `Starting evolve generation (model: ${resolvedModel || "default"})`)

      const result = await provider.generate(messages, {
        model: resolvedModel,
        maxTokens: 16384,
      })

      // Track usage
      const stepTokens = result.tokensUsed || 0
      const stepModel = resolvedModel || "claude-sonnet-4-20250514"
      const estInput = Math.round(stepTokens * 0.3)
      const estOutput = stepTokens - estInput
      globalTracker.recordStep(1, stepModel, estInput, estOutput)
      debug.api("evolve", stepModel, stepTokens)

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
      const writtenFiles: string[] = []

      for (const change of approved) {
        // Permissions-aware file writing
        if (globalHooks.has("pre:file-write")) {
          const writeResult = await globalHooks.execute("pre:file-write", {
            event: "pre:file-write",
            file: change.path,
            fileContent: change.proposed,
            cwd,
          })
          if (writeResult.blocked) {
            logger.warn(`Skipped ${change.path}: ${writeResult.message || "blocked by hook"}`)
            continue
          }
        }

        try {
          const fullPath = path.resolve(cwd, change.path)
          const dir = path.dirname(fullPath)
          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(fullPath, change.proposed, "utf8")
          written++
          writtenFiles.push(change.path)

          // post:file-write hook
          if (globalHooks.has("post:file-write")) {
            await globalHooks.execute("post:file-write", {
              event: "post:file-write",
              file: change.path,
              cwd,
            })
          }
        } catch (error: any) {
          logger.error(`Failed to write ${change.path}: ${error.message}`)
          errors++
        }
      }

      writeSpinner.stop()

      logger.break()
      logger.success(`Applied ${written} change(s):`)
      for (const change of approved) {
        if (writtenFiles.includes(change.path)) {
          console.log(`  ${chalk.green("~")} ${change.path}`)
        }
      }
      if (errors) {
        logger.error(`${errors} file(s) failed to write.`)
      }

      // Record in memory
      try {
        const memory = new MemoryHierarchy(cwd)
        await memory.load()
        await memory.recordGeneration({
          type: "evolution",
          task: effectiveTask,
          files: writtenFiles,
          success: errors === 0,
          error: errors > 0 ? `${errors} file(s) failed to write` : undefined,
          context: {
            techStack: context.techStack.languages.map(String),
            frameworks: context.techStack.frameworks.map(String),
            skillsUsed: matchedSkills.map((m) => m.skill.frontmatter.name),
          },
        })
      } catch {
        // Memory recording is non-critical
      }

      // Heal loop — verify and auto-fix if requested
      if (opts.heal !== false && writtenFiles.length > 0) {
        const { HealEngine } = await import("@/src/runtime/heal")
        const healEngine = new HealEngine(cwd, {
          enabled: true,
          testCommand: opts.testCmd,
          buildCommand: opts.buildCmd,
          maxAttempts: 3,
          provider: providerName,
          model: resolvedModel,
          apiKey: opts.apiKey,
        })

        const healSpinner = ora("Verifying changes...").start()
        const healResult = await healEngine.detectAndHeal(writtenFiles, effectiveTask)
        healSpinner.stop()

        if (healResult.healed) {
          if (healResult.attempts === 0) {
            logger.success("Verification passed — changes are clean")
          } else {
            logger.success(
              `Auto-healed in ${healResult.attempts} attempt(s)` +
              (healResult.filesChanged.length ? ` (fixed: ${healResult.filesChanged.join(", ")})` : "")
            )
          }
        } else if (healResult.error) {
          logger.error(`Verification failed after ${healResult.attempts} attempt(s):`)
          console.log(chalk.dim(`  ${healResult.error.split("\n").slice(0, 3).join("\n  ")}`))

          await globalHooks.execute("on:error", {
            event: "on:error",
            error: new Error(healResult.error),
            task: effectiveTask,
            cwd,
          })
        }
      }

      // post:generate hook
      if (globalHooks.has("post:generate")) {
        await globalHooks.execute("post:generate", {
          event: "post:generate",
          task: effectiveTask,
          content: result.content,
          cwd,
        })
      }

      if (result.tokensUsed) {
        logger.break()
        const summary = globalTracker.getSummary()
        logger.info(`Tokens used: ${result.tokensUsed} ($${summary.totalCost.toFixed(4)})`)
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

  // Project instructions (SHADXN.md / CLAUDE.md)
  if (context.projectInstructions) {
    sections.push(`# Project Instructions\n${context.projectInstructions}`)
  }

  // Memory context (past generations, patterns, preferences)
  if (context.memoryContext) {
    sections.push(context.memoryContext)
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
