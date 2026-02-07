#!/usr/bin/env node
import { add } from "@/src/commands/add"
import { diff } from "@/src/commands/diff"
import { init } from "@/src/commands/init"
import { registry } from "@/src/commands/registry"
import { gen } from "@/src/commands/generate"
import { skill } from "@/src/commands/skill"
import { inspect } from "@/src/commands/inspect"
import { evolve } from "@/src/commands/evolve"
import { serve } from "@/src/commands/serve"
import { create } from "@/src/commands/create"
import { run } from "@/src/commands/run"
import { model } from "@/src/commands/model"
import { chat } from "@/src/commands/chat"
import { git } from "@/src/commands/git"
import { a2a } from "@/src/commands/a2a"
import { Command } from "commander"
import { globalHooks, loadHooks } from "@/src/hooks"

import { getPackageInfo } from "./utils/get-package-info"

process.on("SIGINT", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))

async function main() {
  const packageInfo = await getPackageInfo()

  // Initialize hooks from project config and .shadxn/hooks/
  const cwd = process.cwd()
  loadHooks(cwd, globalHooks)

  const program = new Command()
    .name("shadxn")
    .description(
      "the AI coding agent — generate, evolve, chat, and manage your codebase with AI"
    )
    .version(
      packageInfo.version || "1.0.0",
      "-v, --version",
      "display the version number"
    )

  program
    .addCommand(chat)
    .addCommand(gen)
    .addCommand(evolve)
    .addCommand(git)
    .addCommand(create)
    .addCommand(run)
    .addCommand(inspect)
    .addCommand(skill)
    .addCommand(serve)
    .addCommand(model)
    .addCommand(init)
    .addCommand(add)
    .addCommand(diff)
    .addCommand(registry)
    .addCommand(a2a)

  // Default to chat when no command is given and stdin is a TTY
  const args = process.argv.slice(2)
  if (args.length === 0 && process.stdin.isTTY) {
    process.argv.push("chat")
  }

  program.parse()
}

main()
