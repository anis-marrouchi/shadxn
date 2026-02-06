// --- Permission Manager: checking and inline prompts for file writes ---

import prompts from "prompts"
import chalk from "chalk"
import type { PermissionMode, PermissionConfig } from "./types"
import { permissionConfigSchema } from "./types"
import { debug } from "@/src/observability"

export type PermissionAction = "allow" | "deny" | "skip"

/**
 * Simple glob matching: supports *, **, and ? wildcards.
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\?/g, "[^/]")
  return new RegExp(`^${regex}$`).test(filePath)
}

export class PermissionManager {
  private mode: PermissionMode
  private allowPatterns: string[]
  private denyPatterns: string[]
  private confirmPatterns: string[]
  private autoAllowAll = false // set when user picks "all" in interactive prompt

  constructor(config?: Partial<PermissionConfig>) {
    const parsed = permissionConfigSchema.parse(config || {})
    this.mode = parsed.mode
    this.allowPatterns = parsed.allow
    this.denyPatterns = parsed.deny
    this.confirmPatterns = parsed.confirm
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
    this.autoAllowAll = false // reset on mode change
    debug.context("permissions", `mode set to ${mode}`)
  }

  /**
   * Check whether a file write should proceed.
   */
  async checkFileWrite(filePath: string): Promise<PermissionAction> {
    debug.context("permissions", `checking write: ${filePath} (mode: ${this.mode})`)

    // Always deny files matching deny patterns
    if (this.matchesAny(filePath, this.denyPatterns)) {
      debug.context("permissions", `denied by pattern: ${filePath}`)
      return "deny"
    }

    switch (this.mode) {
      case "yolo":
        return "allow"

      case "plan":
        return "skip"

      case "acceptEdits":
        return "allow"

      case "default":
        // If user already chose "all", auto-allow
        if (this.autoAllowAll) return "allow"

        // Auto-allow if matches allow patterns
        if (this.matchesAny(filePath, this.allowPatterns)) {
          return "allow"
        }

        // Must confirm if matches confirm patterns or no patterns match
        return this.promptUser(filePath)

      default:
        return "allow"
    }
  }

  /**
   * Check whether a command should proceed (for pre:command hook).
   */
  async checkCommand(command: string): Promise<"allow" | "deny"> {
    if (this.mode === "yolo") return "allow"
    if (this.mode === "plan") return "deny"
    // For default and acceptEdits, commands are allowed
    return "allow"
  }

  private matchesAny(filePath: string, patterns: string[]): boolean {
    return patterns.some((p) => matchGlob(filePath, p))
  }

  private async promptUser(filePath: string): Promise<PermissionAction> {
    const { action } = await prompts({
      type: "select",
      name: "action",
      message: `Write file ${chalk.cyan(filePath)}?`,
      choices: [
        { title: "Yes", value: "allow" },
        { title: "No", value: "deny" },
        { title: "All (allow remaining)", value: "all" },
        { title: "Skip", value: "skip" },
      ],
      initial: 0,
    })

    if (action === "all") {
      this.autoAllowAll = true
      return "allow"
    }

    return action || "deny"
  }
}

export const globalPermissions = new PermissionManager()
