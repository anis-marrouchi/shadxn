import { z } from "zod"

// --- Provider abstraction ---

export interface GenerationMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface GenerationResult {
  content: string
  files: GeneratedFile[]
  followUp?: string // Agent may ask for more info
  tokensUsed?: number
}

export interface GeneratedFile {
  path: string
  content: string
  language?: string
  description?: string
}

export interface ProviderOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  apiKey?: string
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; name: string; id: string }
  | { type: "tool_use_delta"; json: string }
  | { type: "tool_use_end"; name: string }
  | { type: "done"; result: GenerationResult }
  | { type: "error"; error: string }

// --- Raw (agentic) API types ---

export interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | ContentBlock[]
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

export interface RawGenerationResult {
  content: ContentBlock[]
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
  usage: { input_tokens: number; output_tokens: number }
}

export interface AgentProvider {
  name: string
  generate(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult>
  stream?(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): AsyncIterable<StreamEvent>
  /** Low-level method returning raw content blocks for the agentic tool_result loop */
  generateRaw?(
    messages: AnthropicMessage[],
    systemPrompt: string,
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    options?: ProviderOptions
  ): Promise<RawGenerationResult>
}

// --- Agent configuration ---

export const agentConfigSchema = z.object({
  provider: z.enum(["claude-code", "claude", "openai", "ollama", "custom"]).default("claude-code"),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  skills: z.array(z.string()).default([]),
  output: z
    .object({
      dir: z.string().default("./generated"),
    })
    .default({}),
  context7: z
    .object({
      enabled: z.boolean().default(true),
      apiKey: z.string().optional(),
    })
    .default({}),
  agentic: z
    .object({
      maxIterations: z.number().default(20),
      enabledTools: z.array(z.string()).default([
        "create_files", "ask_user", "read_file",
        "search_files", "list_directory", "run_command", "edit_file",
      ]),
      disabledTools: z.array(z.string()).default([]),
    })
    .default({}),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>

// --- Output types ---

export const OUTPUT_TYPES = [
  "component",
  "page",
  "api",
  "website",
  "document",
  "script",
  "config",
  "skill",
  "media",
  "report",
  "test",
  "workflow",
  "schema",
  "email",
  "diagram",
  "auto",
] as const

export type OutputType = (typeof OUTPUT_TYPES)[number]

export const outputTypeDescriptions: Record<OutputType, string> = {
  component: "UI component (any framework)",
  page: "Full page or screen",
  api: "API endpoint, route handler, or service",
  website: "Multi-page website or app",
  document: "Markdown, documentation, or specification",
  script: "Standalone script or utility",
  config: "Configuration file or setup",
  skill: "Agent skill (SKILL.md format for skills.sh)",
  media: "Media generation prompt (image/audio/video description)",
  report: "Analysis report or audit",
  test: "Test suite, test fixtures, or test data",
  workflow: "CI/CD pipeline, GitHub Actions, or automation",
  schema: "Database schema, Zod validators, or GraphQL types",
  email: "Email template (React Email, MJML, HTML)",
  diagram: "Mermaid, D2, or PlantUML diagram",
  auto: "Auto-detect the best output type",
}
