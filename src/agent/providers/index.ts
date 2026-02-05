import type { AgentProvider } from "./types"
import { ClaudeProvider } from "./claude"

export type ProviderName = "claude" | "openai" | "ollama" | "custom"

export function createProvider(
  name: ProviderName = "claude",
  apiKey?: string
): AgentProvider {
  switch (name) {
    case "claude":
      return new ClaudeProvider(apiKey)
    case "openai":
      throw new Error(
        "OpenAI provider coming soon. Set provider to 'claude' or contribute at github.com/anis-marrouchi/shadxn"
      )
    case "ollama":
      throw new Error(
        "Ollama provider coming soon. Set provider to 'claude' or contribute at github.com/anis-marrouchi/shadxn"
      )
    default:
      throw new Error(`Unknown provider: ${name}. Supported: claude`)
  }
}

export { ClaudeProvider } from "./claude"
export type { AgentProvider, GenerationMessage, GenerationResult, GeneratedFile, ProviderOptions } from "./types"
