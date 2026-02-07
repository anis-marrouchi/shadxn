import { z } from "zod"

// --- Hook system types ---

export const HOOK_EVENTS = [
  "pre:generate",
  "post:generate",
  "pre:file-write",
  "post:file-write",
  "pre:prompt",
  "post:response",
  "pre:command",
  "on:error",
  "pre:tool-call",
  "post:tool-call",
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

// Which hooks can block (return { blocked: true } to cancel the operation)
export const BLOCKING_EVENTS: HookEvent[] = [
  "pre:generate",
  "pre:file-write",
  "pre:prompt",
  "post:response",
  "pre:command",
  "pre:tool-call",
]

export type HookType = "command" | "prompt" | "script"

export const hookDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(["command", "prompt", "script"]),
  // For "command" type: shell command with {{variable}} interpolation
  command: z.string().optional(),
  // For "prompt" type: LLM prompt template
  prompt: z.string().optional(),
  // For "prompt" type: override provider/model for this hook
  provider: z.enum(["claude-code", "claude", "openai", "ollama", "custom"]).optional(),
  model: z.string().optional(),
  // For "script" type: path to JS/TS file exporting a handler
  script: z.string().optional(),
  // Hook priority (lower runs first, default 100)
  priority: z.number().default(100),
  // Whether this hook is enabled
  enabled: z.boolean().default(true),
})

export type HookDefinition = z.infer<typeof hookDefinitionSchema>

export interface HookContext {
  event: HookEvent
  // Data varies by event
  task?: string
  file?: string
  fileContent?: string
  content?: string
  command?: string
  error?: Error
  cwd?: string
  [key: string]: unknown
}

export interface HookResult {
  // If true, the operation is blocked/cancelled
  blocked?: boolean
  // Optional message explaining why it was blocked
  message?: string
  // Modified data to pass forward (e.g., modified file content)
  modified?: Record<string, unknown>
}

export type HookHandler = (context: HookContext) => Promise<HookResult>
