import { handleError } from "@/utils/handle-error"
import { logger } from "@/utils/logger"
import { startMcpServer } from "@/mcp"
import chalk from "chalk"
import { Command } from "commander"

// --- `shadxn serve` — run as MCP server for AI editors ---

export const serve = new Command()
  .name("serve")
  .description("run shadxn as an MCP server for AI editors (Claude Code, Cursor, Windsurf, etc.)")
  .option("--stdio", "use stdio transport (default)", true)
  .option(
    "-c, --cwd <cwd>",
    "working directory",
    process.cwd()
  )
  .action(async (opts) => {
    try {
      if (opts.stdio !== false) {
        // stdio mode — all logging goes to stderr, stdout is JSON-RPC
        await startMcpServer()
      } else {
        logger.error("Only stdio transport is currently supported.")
        logger.info(
          `Usage: ${chalk.green("shadxn serve --stdio")} or configure in your MCP client.`
        )
        logger.break()
        logger.info("Add to Claude Code:")
        logger.info(
          chalk.dim(
            '  claude mcp add shadxn -- npx shadxn serve --stdio'
          )
        )
        logger.break()
        logger.info("Add to Cursor/MCP config:")
        logger.info(
          chalk.dim(
            JSON.stringify(
              {
                mcpServers: {
                  shadxn: {
                    command: "npx",
                    args: ["shadxn", "serve", "--stdio"],
                  },
                },
              },
              null,
              2
            )
          )
        )
      }
    } catch (error) {
      handleError(error)
    }
  })
