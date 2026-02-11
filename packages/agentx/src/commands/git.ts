import { Command } from "commander"
import chalk from "chalk"
import ora from "ora"
import { handleError } from "@/utils/handle-error"
import { logger } from "@/utils/logger"
import { GitManager } from "@/git"
import { createProvider } from "@/agent/providers"

export const git = new Command()
  .name("git")
  .description("AI-powered git operations")

git
  .command("status")
  .alias("s")
  .description("show git status with summary")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action(async (opts) => {
    try {
      const gm = new GitManager(opts.cwd)
      if (!(await gm.isRepo())) {
        logger.error("Not a git repository")
        process.exit(1)
      }

      const status = await gm.status()

      logger.break()
      logger.info(`Branch: ${chalk.bold(status.branch)}`)
      logger.break()

      if (status.isClean) {
        logger.success("Working tree clean")
        return
      }

      if (status.staged.length) {
        logger.success(`Staged (${status.staged.length}):`)
        for (const f of status.staged) {
          console.log(`  ${chalk.green("+")} ${f}`)
        }
      }

      if (status.modified.length) {
        logger.warn(`Modified (${status.modified.length}):`)
        for (const f of status.modified) {
          console.log(`  ${chalk.yellow("~")} ${f}`)
        }
      }

      if (status.untracked.length) {
        console.log(chalk.dim(`Untracked (${status.untracked.length}):`))
        for (const f of status.untracked) {
          console.log(`  ${chalk.dim("?")} ${f}`)
        }
      }

      if (status.deleted.length) {
        logger.error(`Deleted (${status.deleted.length}):`)
        for (const f of status.deleted) {
          console.log(`  ${chalk.red("-")} ${f}`)
        }
      }

      logger.break()
    } catch (error) {
      handleError(error)
    }
  })

git
  .command("commit")
  .alias("c")
  .description("create an AI-generated commit message and commit")
  .option("-m, --message <message>", "use a custom commit message")
  .option("-a, --all", "stage all changes before committing", false)
  .option("--ai", "generate commit message with AI", true)
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action(async (opts) => {
    try {
      const gm = new GitManager(opts.cwd)
      if (!(await gm.isRepo())) {
        logger.error("Not a git repository")
        process.exit(1)
      }

      // Stage all if requested
      if (opts.all) {
        await gm.addAll()
      }

      const status = await gm.status()
      if (status.staged.length === 0) {
        logger.warn("Nothing staged to commit. Use --all to stage everything.")
        process.exit(0)
      }

      let message = opts.message
      if (!message) {
        if (opts.ai) {
          const spinner = ora("Generating commit message...").start()
          try {
            const provider = createProvider()
            message = await gm.generateCommitMessage(provider)
            spinner.stop()
            logger.info(`Message: ${chalk.bold(message)}`)
          } catch {
            spinner.stop()
            message = await gm.generateCommitMessage()
            logger.info(`Message: ${chalk.bold(message)}`)
          }
        } else {
          message = await gm.generateCommitMessage()
        }
      }

      const result = await gm.commit(message)
      logger.break()
      logger.success(
        `[${result.hash}] ${result.message} (${result.filesChanged} file(s))`
      )
    } catch (error) {
      handleError(error)
    }
  })

git
  .command("diff")
  .alias("d")
  .description("show diff of changes")
  .option("-s, --staged", "show staged changes", false)
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action(async (opts) => {
    try {
      const gm = new GitManager(opts.cwd)
      const diffOutput = await gm.diff(opts.staged)

      if (!diffOutput.trim()) {
        logger.info(opts.staged ? "No staged changes" : "No changes")
        return
      }

      console.log(diffOutput)
    } catch (error) {
      handleError(error)
    }
  })

git
  .command("log")
  .alias("l")
  .description("show recent commits")
  .option("-n, --count <n>", "number of commits to show", "10")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action(async (opts) => {
    try {
      const gm = new GitManager(opts.cwd)
      const entries = await gm.log(parseInt(opts.count))

      if (!entries.length) {
        logger.info("No commits yet")
        return
      }

      logger.break()
      for (const entry of entries) {
        console.log(
          `${chalk.yellow(entry.shortHash)} ${entry.message} ${chalk.dim(`— ${entry.author}`)}`
        )
      }
      logger.break()
    } catch (error) {
      handleError(error)
    }
  })
