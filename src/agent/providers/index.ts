import type { AgentProvider } from "./types"
import { ClaudeProvider } from "./claude"
import { ClaudeCodeProvider } from "./claude-code"
import { loadAuthConfig } from "@/src/utils/auth-store"

export type ProviderName = "claude-code" | "claude" | "openai" | "ollama" | "custom"

export function createProvider(
  name: ProviderName = "claude-code",
  apiKey?: string
): AgentProvider {
  // Auto-detect provider from stored config when using the default
  let resolvedName = name
  if (name === "claude-code" && !apiKey) {
    const stored = loadAuthConfig()
    if (stored) {
      resolvedName = stored.provider
    }
  }

  switch (resolvedName) {
    case "claude-code":
      return new ClaudeCodeProvider()
    case "claude":
      return new ClaudeProvider(apiKey)
    case "openai":
      throw new Error(
        "OpenAI provider coming soon. Set provider to 'claude-code' or contribute at github.com/anis-marrouchi/shadxn"
      )
    case "ollama":
      throw new Error(
        "Ollama provider coming soon. Set provider to 'claude-code' or contribute at github.com/anis-marrouchi/shadxn"
      )
    default:
      throw new Error(`Unknown provider: ${resolvedName}. Supported: claude-code, claude`)
  }
}

export { ClaudeProvider } from "./claude"
export { ClaudeCodeProvider } from "./claude-code"
export type { AgentProvider, GenerationMessage, GenerationResult, GeneratedFile, ProviderOptions, StreamEvent } from "./types"
