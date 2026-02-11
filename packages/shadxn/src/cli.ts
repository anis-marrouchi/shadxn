#!/usr/bin/env node
import { init } from "@/commands/init"
import { add } from "@/commands/add"
import { diff } from "@/commands/diff"
import { registry } from "@/commands/registry"
import { Command } from "commander"

process.on("SIGINT", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))

async function main() {
  const program = new Command()
    .name("shadxn")
    .description(
      "AI-powered design system tool — component registry, styling, and code transforms"
    )
    .version("0.1.0", "-v, --version", "display the version number")

  program
    .addCommand(init)
    .addCommand(add)
    .addCommand(diff)
    .addCommand(registry)

  program.parse()
}

main()
