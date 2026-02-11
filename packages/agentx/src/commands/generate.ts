import { existsSync } from "fs"
import path from "path"
import { handleError } from "@/utils/handle-error"
import { logger } from "@/utils/logger"
import { generateStream } from "@/agent"
import { OUTPUT_TYPES, outputTypeDescriptions } from "@/agent/providers/types"
import chalk from "chalk"
import { Command } from "commander"
import ora from "ora"
import prompts from "prompts"
import { z } from "zod"
import { setDebug } from "@/observability"
import { globalTracker } from "@/observability"
import { globalPermissions, type PermissionMode } from "@/permissions"
import { GenerateTui } from "@/utils/generate-tui"
import { renderMarkdownForTerminal } from "@/utils/render-markdown"

const generateOptionsSchema = z.object({
  task: z.string().optional(),
  type: z.string().default("auto"),
  output: z.string().optional(),
  overwrite: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  provider: z.enum(["claude-code", "claude", "openai", "ollama", "custom"]).default("claude-code"),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  cwd: z.string(),
  noContext7: z.boolean().default(false),
  yes: z.boolean().default(false),
})

export const gen = new Command()
  .name("generate")
  .aliases(["gen", "g"])
  .description("generate anything using AI — components, pages, APIs, docs, skills, and more")
  .argument("[task...]", "describe what you want to generate")
  .option(
    "-t, --type <type>",
    `output type: ${OUTPUT_TYPES.join(", ")}`,
    "auto"
  )
  .option("-o, --output <dir>", "output directory")
  .option("--overwrite", "overwrite existing files", false)
  .option("--dry-run", "preview without writing files", false)
  .option(
    "-p, --provider <provider>",
    "AI provider (claude-code, claude, openai, ollama)",
    "claude-code"
  )
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key for the provider")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .option("--no-context7", "disable Context7 documentation lookup")
  .option(
    "--max-steps <n>",
    "max agentic loop steps for complex generation (default: 5)",
    "5"
  )
  .option("-y, --yes", "skip confirmation prompts", false)
  .option("--debug", "enable debug mode with verbose logging", false)
  .option("--no-tui", "disable interactive TUI output")
  .option("--mode <mode>", "permission mode (default, acceptEdits, plan, yolo)", "yolo")
  .option("--heal", "verify generated code and auto-fix errors")
  .option("--no-heal", "skip verification after generation")
  .option("--test-cmd <cmd>", "test command for heal verification")
  .option("--build-cmd <cmd>", "build command for heal verification")
  .action(async (taskParts, opts) => {
    try {
      let task = taskParts?.length ? taskParts.join(" ") : opts.task

      if (opts.debug) {
        setDebug(true)
      }

      if (opts.mode) {
        globalPermissions.setMode(opts.mode as PermissionMode)
      }

      const cwd = path.resolve(opts.cwd)
      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist.`)
        process.exit(1)
      }

      // Interactive task input if not provided
      if (!task) {
        const response = await prompts({
          type: "text",
          name: "task",
          message: "What would you like to generate?",
          validate: (v) => (v.trim() ? true : "Please describe what to generate"),
        })

        if (!response.task) {
          logger.warn("No task provided. Exiting.")
          process.exit(0)
        }
        task = response.task
      }

      // Show available output types if type is "auto" and user wants to choose
      if (opts.type === "auto" && !opts.yes) {
        const { type } = await prompts({
          type: "select",
          name: "type",
          message: "Output type (or auto-detect)",
          choices: [
            { title: "Auto-detect", value: "auto" },
            ...OUTPUT_TYPES.filter((t) => t !== "auto").map((t) => ({
              title: `${t} — ${outputTypeDescriptions[t]}`,
              value: t,
            })),
          ],
          initial: 0,
        })

        if (type !== undefined) {
          opts.type = type
        }
      }

      const options = generateOptionsSchema.parse({
        task,
        ...opts,
        apiKey: opts.apiKey,
        noContext7: !opts.context7,
      })

      const maxSteps = parseInt(opts.maxSteps || "5", 10)
      const useTui = Boolean(opts.tui) && Boolean(process.stdout.isTTY) && !Boolean(opts.debug)
      const spinner = (!useTui && !opts.debug) ? ora("Waiting for provider...").start() : undefined

      const tui = useTui
        ? new GenerateTui({
          task,
          provider: options.provider,
          model: options.model,
          cwd,
          outputDir: options.output,
          outputType: options.type,
          maxSteps,
          overwrite: options.overwrite,
          dryRun: options.dryRun,
        })
        : undefined

      if (!useTui) {
        // Show what we're about to do (plain logs).
        logger.break()
        logger.info(`Task: ${chalk.bold(task)}`)
        logger.info(`Provider: ${chalk.bold(options.provider)}`)
        if (options.type !== "auto") {
          logger.info(`Type: ${chalk.bold(options.type)}`)
        }
        if (options.output) {
          logger.info(`Output: ${chalk.bold(options.output)}`)
        }
        if (options.dryRun) {
          logger.warn("Dry run mode — no files will be written")
        }
        logger.break()
      }

      tui?.start()

      let result: any | undefined
      let streamError: string | undefined
      for await (const event of generateStream({
        task,
        outputType: options.type as any,
        outputDir: options.output,
        overwrite: options.overwrite,
        dryRun: options.dryRun,
        provider: options.provider as any,
        model: options.model,
        apiKey: options.apiKey,
        cwd,
        context7: !options.noContext7,
        interactive: !options.yes,
        maxSteps,
        heal: opts.heal,
        healConfig: (opts.testCmd || opts.buildCmd) ? {
          testCommand: opts.testCmd,
          buildCommand: opts.buildCmd,
        } : undefined,
      })) {
        tui?.onEvent(event as any)

        if (!useTui) {
          if (event.type === "context_ready") {
            if (spinner) spinner.text = "Generating..."
          }
          if (event.type === "context_ready") {
            logger.info("Analyzing project... done")
            logger.info(`Output type: ${event.outputType}`)
          } else if (event.type === "iteration") {
            logger.info(`Step ${event.iteration}/${maxSteps}...`)
          } else if (event.type === "tool_call") {
            logger.info(`Tool: ${event.name}`)
          } else if (event.type === "tool_result") {
            logger.info(`Tool result: ${event.name}${event.is_error ? " (error)" : ""}`)
          } else if (event.type === "error") {
            logger.error(event.error)
          }
        }

        if (event.type === "generate_result") {
          result = event.result
        }
        if (event.type === "error") {
          streamError = event.error
        }
      }

      spinner?.stop()
      tui?.stop()
      if (streamError) {
        throw new Error(streamError)
      }
      if (!result) {
        throw new Error("Generation finished without a result")
      }

      // Handle follow-up questions
      if (result.followUp) {
        // Ensure the terminal is back to normal before prompting.
        logger.break()
        logger.info(chalk.yellow("The agent needs more information:"))
        logger.break()
        if (result.content) {
          const rendered = process.stdout.isTTY
            ? renderMarkdownForTerminal(result.content)
            : result.content
          console.log(rendered)
          logger.break()
        }
        console.log(process.stdout.isTTY ? renderMarkdownForTerminal(result.followUp) : result.followUp)
        logger.break()

        const { answer } = await prompts({
          type: "text",
          name: "answer",
          message: "Your answer:",
        })

        if (answer) {
          const task2 =
            `${task}\n\n` +
            `Previous agent output (for context):\n${result.content || ""}\n\n` +
            `User response: ${answer}\n\n` +
            `If the above was a plan awaiting approval and the user approved, proceed to implementation now using create_files (do not ask for approval again).`
          const tui2 = useTui
            ? new GenerateTui({
              task: task2,
              provider: options.provider,
              model: options.model,
              cwd,
              outputDir: options.output,
              outputType: options.type,
              maxSteps,
              overwrite: options.overwrite,
              dryRun: options.dryRun,
            })
            : undefined

          tui2?.start()

          let result2: any | undefined
          let streamError2: string | undefined
          for await (const event of generateStream({
            task: task2,
            outputType: options.type as any,
            outputDir: options.output,
            overwrite: options.overwrite,
            dryRun: options.dryRun,
            provider: options.provider as any,
            model: options.model,
            apiKey: options.apiKey,
            cwd,
            context7: !options.noContext7,
            interactive: false,
            maxSteps,
            heal: opts.heal,
            healConfig: (opts.testCmd || opts.buildCmd) ? {
              testCommand: opts.testCmd,
              buildCommand: opts.buildCmd,
            } : undefined,
          })) {
            tui2?.onEvent(event as any)
            if (event.type === "generate_result") result2 = event.result
            if (event.type === "error") streamError2 = event.error
          }

          tui2?.stop()
          if (streamError2) throw new Error(streamError2)
          if (!result2) throw new Error("Generation finished without a result")
          printResult(result2)
        }
      } else {
        printResult(result)
      }
    } catch (error) {
      handleError(error)
    }
  })

function printResult(result: any) {
  logger.break()

  if (result.content) {
    const rendered = process.stdout.isTTY
      ? renderMarkdownForTerminal(result.content)
      : result.content
    console.log(rendered)
    logger.break()
  }

  if (result.files.written.length) {
    logger.success(`Created ${result.files.written.length} file(s):`)
    for (const file of result.files.written) {
      console.log(`  ${chalk.green("+")} ${file}`)
    }
  }

  if (result.files.skipped.length) {
    logger.warn(`Skipped ${result.files.skipped.length} existing file(s):`)
    for (const file of result.files.skipped) {
      console.log(`  ${chalk.yellow("~")} ${file} (use --overwrite)`)
    }
  }

  if (result.files.errors.length) {
    logger.error(`Failed ${result.files.errors.length} file(s):`)
    for (const err of result.files.errors) {
      console.log(`  ${chalk.red("x")} ${err}`)
    }
  }

  // Display heal results
  if (result.healResult) {
    logger.break()
    if (result.healResult.healed) {
      if (result.healResult.attempts === 0) {
        logger.success("Verification passed — generated code is clean")
      } else {
        logger.success(
          `Auto-healed in ${result.healResult.attempts} attempt(s)` +
          (result.healResult.filesChanged?.length ? ` (fixed: ${result.healResult.filesChanged.join(", ")})` : "")
        )
      }
    } else if (result.healResult.error) {
      logger.error(`Verification failed after ${result.healResult.attempts} attempt(s):`)
      console.log(chalk.dim(`  ${result.healResult.error.split("\n").slice(0, 3).join("\n  ")}`))
    }
  }

  if (result.tokensUsed) {
    logger.break()
    const summary = globalTracker.getSummary()
    if (summary.steps.length > 1) {
      logger.info(`Tokens used: ${result.tokensUsed} across ${summary.steps.length} steps`)
      for (const step of summary.steps) {
        logger.info(`  Step ${step.step}: ${(step.inputTokens + step.outputTokens).toLocaleString()} tokens ($${step.cost.toFixed(4)})`)
      }
      logger.info(`  Total cost: $${summary.totalCost.toFixed(4)}`)
    } else {
      logger.info(`Tokens used: ${result.tokensUsed} ($${summary.totalCost.toFixed(4)})`)
    }
  }
}
