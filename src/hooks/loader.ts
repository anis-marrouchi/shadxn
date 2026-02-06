import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import type { HookEvent, HookDefinition } from "./types"
import { HOOK_EVENTS, hookDefinitionSchema } from "./types"
import { HookRegistry } from "./registry"
import { logger } from "@/src/utils/logger"

// --- Hook Loader: load hooks from config and .shadxn/hooks/ ---

interface HooksConfig {
  hooks?: Partial<Record<HookEvent, HookDefinition[]>>
}

/**
 * Load hooks from shadxn.config.json and .shadxn/hooks/ directory.
 */
export function loadHooks(cwd: string, registry: HookRegistry): void {
  loadHooksFromConfig(cwd, registry)
  loadHooksFromDirectory(cwd, registry)
}

/**
 * Load hook definitions from shadxn.config.json.
 */
function loadHooksFromConfig(cwd: string, registry: HookRegistry): void {
  const configPath = path.join(cwd, "shadxn.config.json")
  if (!existsSync(configPath)) return

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as HooksConfig
    if (!raw.hooks) return

    for (const [eventName, definitions] of Object.entries(raw.hooks)) {
      if (!HOOK_EVENTS.includes(eventName as HookEvent)) {
        logger.warn(`Unknown hook event in config: ${eventName}`)
        continue
      }

      const event = eventName as HookEvent
      if (!Array.isArray(definitions)) continue

      for (const def of definitions) {
        try {
          const parsed = hookDefinitionSchema.parse(def)
          registry.register(event, parsed)
        } catch (error: any) {
          logger.warn(`Invalid hook definition for ${event}: ${error.message}`)
        }
      }
    }
  } catch (error: any) {
    logger.warn(`Failed to load hooks from config: ${error.message}`)
  }
}

/**
 * Load hook scripts from .shadxn/hooks/ directory.
 * Files are named <event>.<name>.ts (e.g., pre-file-write.format.ts).
 */
function loadHooksFromDirectory(cwd: string, registry: HookRegistry): void {
  const hooksDir = path.join(cwd, ".shadxn", "hooks")
  if (!existsSync(hooksDir)) return

  try {
    const files = readdirSync(hooksDir).filter(
      (f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs")
    )

    for (const file of files) {
      // Parse filename: <event>.<name>.<ext>
      // Event uses dashes in filename: pre-file-write → pre:file-write
      const parts = file.replace(/\.(ts|js|mjs)$/, "").split(".")
      if (parts.length < 2) {
        logger.warn(`Hook file "${file}" should be named <event>.<name>.<ext>`)
        continue
      }

      const eventSlug = parts[0]
      const name = parts.slice(1).join(".")

      // Convert slug to event name: pre-file-write → pre:file-write
      const eventName = eventSlug.replace(/-/g, ":") as HookEvent
      if (!HOOK_EVENTS.includes(eventName)) {
        // Try replacing first dash only: pre-generate → pre:generate
        const altEvent = eventSlug.replace("-", ":") as HookEvent
        if (!HOOK_EVENTS.includes(altEvent)) {
          logger.warn(`Unknown hook event in filename: ${file}`)
          continue
        }
        registry.register(altEvent, {
          name,
          type: "script",
          script: path.join(hooksDir, file),
          priority: 100,
          enabled: true,
        })
        continue
      }

      registry.register(eventName, {
        name,
        type: "script",
        script: path.join(hooksDir, file),
        priority: 100,
        enabled: true,
      })
    }
  } catch (error: any) {
    logger.warn(`Failed to load hooks from directory: ${error.message}`)
  }
}
