import { existsSync } from "fs"
import path from "path"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { generate } from "@/src/agent"
import { OUTPUT_TYPES, outputTypeDescriptions } from "@/src/agent/providers/types"
import chalk from "chalk"
import { Command } from "commander"
import ora from "ora"
import prompts from "prompts"
import { z } from "zod"

const generateOptionsSchema = z.object({
  task: z.string().optional(),
  type: z.string().default("auto"),
  output: z.string().optional(),
  overwrite: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  provider: z.enum(["claude", "openai", "ollama", "custom"]).default("claude"),
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
    "AI provider (claude, openai, ollama)",
    "claude"
  )
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key for the provider")
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .option("--no-context7", "disable Context7 documentation lookup")
  .option("-y, --yes", "skip confirmation prompts", false)
  .action(async (taskParts, opts) => {
    try {
      let task = taskParts?.length ? taskParts.join(" ") : opts.task

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

      // Show what we're about to do
      logger.break()
      logger.info(`Task: ${chalk.bold(task)}`)
      logger.info(`Provider: ${chalk.bold(options.provider)}`)
      if (options.type !== "auto") {
        logger.info(`Type: ${chalk.bold(options.type)}`)
      }
      if (options.dryRun) {
        logger.warn("Dry run mode — no files will be written")
      }
      logger.break()

      const spinner = ora("Analyzing project and generating...").start()

      const result = await generate({
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
      })

      spinner.stop()

      // Handle follow-up questions
      if (result.followUp) {
        logger.break()
        logger.info(chalk.yellow("The agent needs more information:"))
        logger.break()
        console.log(result.followUp)
        logger.break()

        const { answer } = await prompts({
          type: "text",
          name: "answer",
          message: "Your answer:",
        })

        if (answer) {
          // Re-run with the additional context
          const spinner2 = ora("Generating with additional context...").start()
          const result2 = await generate({
            task: `${task}\n\nAdditional context: ${answer}`,
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
          })
          spinner2.stop()
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
    console.log(result.content)
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

  if (result.tokensUsed) {
    logger.break()
    logger.info(`Tokens used: ${result.tokensUsed}`)
  }
}
