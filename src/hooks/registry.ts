import { execa } from "execa"
import type { HookEvent, HookDefinition, HookContext, HookResult, HookHandler } from "./types"
import { BLOCKING_EVENTS } from "./types"
import { logger } from "@/src/utils/logger"
import { debug } from "@/src/observability"

// --- Hook Registry: registration, priority ordering, execution ---

interface RegisteredHook {
  event: HookEvent
  definition: HookDefinition
  handler: HookHandler
}

export class HookRegistry {
  private hooks: Map<HookEvent, RegisteredHook[]> = new Map()

  /**
   * Register a hook for an event.
   */
  register(event: HookEvent, definition: HookDefinition): void {
    if (!definition.enabled) return

    const handler = this.createHandler(definition)
    const entry: RegisteredHook = { event, definition, handler }

    const existing = this.hooks.get(event) || []
    existing.push(entry)
    // Sort by priority (lower number = runs first)
    existing.sort((a, b) => a.definition.priority - b.definition.priority)
    this.hooks.set(event, existing)
  }

  /**
   * Execute all hooks for an event. Returns combined result.
   * For blocking events, stops at the first hook that returns { blocked: true }.
   */
  async execute(event: HookEvent, context: HookContext): Promise<HookResult> {
    const registered = this.hooks.get(event)
    if (!registered?.length) {
      return {}
    }

    const canBlock = BLOCKING_EVENTS.includes(event)
    let combinedModified: Record<string, unknown> = {}

    for (const hook of registered) {
      const start = Date.now()
      try {
        const result = await hook.handler({ ...context, ...combinedModified })
        const duration = Date.now() - start

        if (result.modified) {
          combinedModified = { ...combinedModified, ...result.modified }
        }

        if (canBlock && result.blocked) {
          debug.hook(hook.definition.name, duration, "blocked")
          return {
            blocked: true,
            message: result.message || `Blocked by hook: ${hook.definition.name}`,
            modified: combinedModified,
          }
        }

        debug.hook(hook.definition.name, duration, "ok")
      } catch (error: any) {
        const duration = Date.now() - start
        debug.hook(hook.definition.name, duration, `error: ${error.message}`)
        logger.warn(`Hook "${hook.definition.name}" failed: ${error.message}`)
        // Non-blocking hooks swallow errors; blocking hooks propagate
        if (canBlock) {
          return {
            blocked: true,
            message: `Hook "${hook.definition.name}" errored: ${error.message}`,
          }
        }
      }
    }

    return { modified: Object.keys(combinedModified).length ? combinedModified : undefined }
  }

  /**
   * Check if any hooks are registered for an event.
   */
  has(event: HookEvent): boolean {
    const registered = this.hooks.get(event)
    return !!registered?.length
  }

  /**
   * Clear all hooks (useful for testing).
   */
  clear(): void {
    this.hooks.clear()
  }

  /**
   * Create a HookHandler from a HookDefinition.
   */
  private createHandler(definition: HookDefinition): HookHandler {
    switch (definition.type) {
      case "command":
        return this.createCommandHandler(definition)
      case "script":
        return this.createScriptHandler(definition)
      case "prompt":
        return this.createPromptHandler(definition)
      default:
        throw new Error(`Unknown hook type: ${definition.type}`)
    }
  }

  /**
   * Command hook: runs a shell command with {{variable}} interpolation.
   * Exit code 0 = success, non-zero = blocked (for blocking events).
   */
  private createCommandHandler(definition: HookDefinition): HookHandler {
    return async (context: HookContext): Promise<HookResult> => {
      if (!definition.command) {
        return {}
      }

      // Interpolate {{variable}} placeholders
      let cmd = definition.command
      cmd = cmd.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
        return String(context[key] ?? "")
      })

      const result = await execa("sh", ["-c", cmd], {
        cwd: context.cwd || process.cwd(),
        reject: false,
        timeout: 60_000,
        env: process.env,
      })

      if (result.exitCode !== 0) {
        return {
          blocked: true,
          message: result.stderr || result.stdout || `Command hook "${definition.name}" failed`,
        }
      }

      return {}
    }
  }

  /**
   * Script hook: imports and runs a JS/TS module that exports a handler function.
   */
  private createScriptHandler(definition: HookDefinition): HookHandler {
    return async (context: HookContext): Promise<HookResult> => {
      if (!definition.script) {
        return {}
      }

      const scriptPath = definition.script.startsWith("/")
        ? definition.script
        : `${context.cwd || process.cwd()}/${definition.script}`

      const mod = await import(scriptPath)
      const handler = mod.default || mod.handler || mod

      if (typeof handler === "function") {
        return await handler(context)
      }

      return {}
    }
  }

  /**
   * Prompt hook: placeholder for single-turn LLM calls.
   * In Phase 1, this logs a warning — full implementation in Phase 2.
   */
  private createPromptHandler(definition: HookDefinition): HookHandler {
    return async (_context: HookContext): Promise<HookResult> => {
      logger.warn(
        `Prompt hook "${definition.name}" registered but prompt hooks require a provider. Skipping.`
      )
      return {}
    }
  }
}
