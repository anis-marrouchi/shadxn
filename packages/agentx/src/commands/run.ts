import { existsSync, promises as fs } from "fs"
import path from "path"
import { handleError } from "@/utils/handle-error"
import { logger } from "@/utils/logger"
import { ShadxnRuntime, type RuntimeConfig } from "@/runtime"
import chalk from "chalk"
import { Command } from "commander"

// --- `shadxn run` — start the intelligent runtime framework ---

export const run = new Command()
  .name("run")
  .description(
    "start the shadxn runtime — an intelligent framework that receives requests, learns, auto-heals, and self-enhances"
  )
  .option("--port <port>", "server port", "3170")
  .option("--host <host>", "server host", "0.0.0.0")
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
  .option("--no-memory", "disable memory/learning")
  .option("--no-heal", "disable auto-heal")
  .option("--no-enhance", "disable self-enhancement")
  .option("--test-cmd <cmd>", "test command for auto-heal")
  .option("--build-cmd <cmd>", "build command for auto-heal")
  .option("--no-cors", "disable CORS")
  .action(async (opts) => {
    try {
      const cwd = path.resolve(opts.cwd)
      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist.`)
        process.exit(1)
      }

      // Load config from shadxn.config.json if it exists
      const configPath = path.resolve(cwd, "shadxn.config.json")
      let fileConfig: Partial<RuntimeConfig> = {}
      if (existsSync(configPath)) {
        try {
          const raw = await fs.readFile(configPath, "utf8")
          fileConfig = JSON.parse(raw)
          logger.info(`Loaded config from ${chalk.dim("shadxn.config.json")}`)
        } catch {
          logger.warn("Failed to parse shadxn.config.json, using defaults")
        }
      }

      const config: Partial<RuntimeConfig> = {
        port: parseInt(opts.port, 10) || fileConfig.port,
        host: opts.host || fileConfig.host,
        provider: (opts.provider || fileConfig.provider) as any,
        model: opts.model || fileConfig.model,
        apiKey: opts.apiKey || fileConfig.apiKey,
        cwd,
        memory: {
          enabled: opts.memory !== false && (fileConfig.memory?.enabled !== false),
        },
        heal: {
          enabled: opts.heal !== false && (fileConfig.heal?.enabled !== false),
          testCommand: opts.testCmd || fileConfig.heal?.testCommand,
          buildCommand: opts.buildCmd || fileConfig.heal?.buildCommand,
        },
        enhance: {
          enabled: opts.enhance !== false && (fileConfig.enhance?.enabled !== false),
          autoSkills: fileConfig.enhance?.autoSkills !== false,
        },
        cors: opts.cors !== false,
      }

      // Banner
      console.log("")
      console.log(chalk.bold.cyan("  ░░░ shadxn runtime ░░░"))
      console.log(chalk.dim("  the intelligent framework"))
      console.log("")

      const runtime = new ShadxnRuntime(config)
      await runtime.start()
    } catch (error) {
      handleError(error)
    }
  })
