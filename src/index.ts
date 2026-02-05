#!/usr/bin/env node
import { add } from "@/src/commands/add"
import { diff } from "@/src/commands/diff"
import { init } from "@/src/commands/init"
import { registry } from "@/src/commands/registry"
import { gen } from "@/src/commands/generate"
import { skill } from "@/src/commands/skill"
import { Command } from "commander"

import { getPackageInfo } from "./utils/get-package-info"

process.on("SIGINT", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))

async function main() {
  const packageInfo = await getPackageInfo()

  const program = new Command()
    .name("shadxn")
    .description(
      "the agentic generation tool — generate components, pages, APIs, docs, skills, and more using AI"
    )
    .version(
      packageInfo.version || "1.0.0",
      "-v, --version",
      "display the version number"
    )

  program
    .addCommand(gen)
    .addCommand(skill)
    .addCommand(init)
    .addCommand(add)
    .addCommand(diff)
    .addCommand(registry)

  program.parse()
}

main()
