import type { AgentProvider } from "./types"
import { ClaudeProvider } from "./claude"
import { ClaudeCodeProvider } from "./claude-code"

export type ProviderName = "claude-code" | "claude" | "openai" | "ollama" | "custom"

export function createProvider(
  name: ProviderName = "claude-code",
  apiKey?: string
): AgentProvider {
  switch (name) {
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
      throw new Error(`Unknown provider: ${name}. Supported: claude-code, claude`)
  }
}

export { ClaudeProvider } from "./claude"
export { ClaudeCodeProvider } from "./claude-code"
export type { AgentProvider, GenerationMessage, GenerationResult, GeneratedFile, ProviderOptions } from "./types"
