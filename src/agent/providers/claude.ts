import type {
  AgentProvider,
  GenerationMessage,
  GenerationResult,
  GeneratedFile,
  ProviderOptions,
} from "./types"

// --- Claude provider (default) using Anthropic SDK ---

const DEFAULT_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_MAX_TOKENS = 8192

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result"
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface AnthropicResponse {
  id: string
  content: AnthropicContentBlock[]
  model: string
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

export class ClaudeProvider implements AgentProvider {
  name = "claude"
  private apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || ""
    if (!this.apiKey) {
      throw new Error(
        "Anthropic API key required. Set ANTHROPIC_API_KEY environment variable or pass --api-key."
      )
    }
  }

  async generate(
    messages: GenerationMessage[],
    options?: ProviderOptions
  ): Promise<GenerationResult> {
    const model = options?.model || DEFAULT_MODEL
    const maxTokens = options?.maxTokens || DEFAULT_MAX_TOKENS

    // Extract system message
    const systemMsg = messages.find((m) => m.role === "system")
    const conversationMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversationMsgs,
      tools: [
        {
          name: "create_files",
          description:
            "Create one or more files as output. Use this when the user asks you to generate code, documents, configs, or any file-based output.",
          input_schema: {
            type: "object",
            properties: {
              files: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    path: {
                      type: "string",
                      description:
                        "Relative file path from project root (e.g., src/components/Button.tsx)",
                    },
                    content: {
                      type: "string",
                      description: "The full content of the file",
                    },
                    language: {
                      type: "string",
                      description: "Programming language or file type",
                    },
                    description: {
                      type: "string",
                      description: "Brief description of what this file does",
                    },
                  },
                  required: ["path", "content"],
                },
              },
              summary: {
                type: "string",
                description: "Brief summary of all generated files",
              },
            },
            required: ["files"],
          },
        },
        {
          name: "ask_user",
          description:
            "Ask the user a clarifying question when you need more information to proceed. Use this when the request is ambiguous or you need to confirm important decisions.",
          input_schema: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The question to ask the user",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of choices for the user",
              },
            },
            required: ["question"],
          },
        },
      ],
    }

    if (systemMsg) {
      body.system = systemMsg.content
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await this.callApi(body)

    return this.parseResponse(response)
  }

  private async callApi(body: Record<string, unknown>): Promise<AnthropicResponse> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${errorText}`)
    }

    return (await res.json()) as AnthropicResponse
  }

  private parseResponse(response: AnthropicResponse): GenerationResult {
    const files: GeneratedFile[] = []
    let content = ""
    let followUp: string | undefined

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text || ""
      }

      if (block.type === "tool_use") {
        if (block.name === "create_files" && block.input) {
          const input = block.input as {
            files: GeneratedFile[]
            summary?: string
          }
          files.push(...(input.files || []))
          if (input.summary) {
            content += `\n${input.summary}`
          }
        }

        if (block.name === "ask_user" && block.input) {
          const input = block.input as { question: string; options?: string[] }
          followUp = input.question
          if (input.options?.length) {
            followUp += `\nOptions: ${input.options.join(", ")}`
          }
        }
      }
    }

    return {
      content,
      files,
      followUp,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    }
  }
}
