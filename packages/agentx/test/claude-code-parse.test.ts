import { describe, it, expect } from "vitest"
import { ClaudeCodeProvider } from "../src/agent/providers/claude-code"

// Access private parseApiResponse via prototype for testing
const provider = Object.create(ClaudeCodeProvider.prototype)
const parse = provider.parseApiResponse.bind(provider)

describe("ClaudeCodeProvider response parsing", () => {
  it("extracts files from create_files tool_use", () => {
    const response = {
      id: "msg_1",
      content: [
        { type: "text", text: "Here's your button component:" },
        {
          type: "tool_use",
          id: "tu_1",
          name: "create_files",
          input: {
            files: [
              {
                path: "src/components/Button.tsx",
                content: 'export function Button() { return <button>Click</button> }',
                language: "tsx",
                description: "Button component",
              },
            ],
            summary: "Created a button component",
          },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 200 },
    }

    const result = parse(response)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe("src/components/Button.tsx")
    expect(result.files[0].content).toContain("Button")
    expect(result.tokensUsed).toBe(300)
  })

  it("extracts multiple files", () => {
    const response = {
      id: "msg_2",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "create_files",
          input: {
            files: [
              { path: "src/Button.tsx", content: "component code" },
              { path: "src/Button.module.css", content: ".btn {}" },
            ],
            summary: "Created component with styles",
          },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 150 },
    }

    const result = parse(response)
    expect(result.files).toHaveLength(2)
    expect(result.files[0].path).toBe("src/Button.tsx")
    expect(result.files[1].path).toBe("src/Button.module.css")
  })

  it("handles ask_user follow-up questions", () => {
    const response = {
      id: "msg_3",
      content: [
        { type: "text", text: "I need some clarification:" },
        {
          type: "tool_use",
          id: "tu_1",
          name: "ask_user",
          input: {
            question: "Which styling approach?",
            options: ["Tailwind CSS", "CSS Modules", "Styled Components"],
          },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      usage: { input_tokens: 80, output_tokens: 100 },
    }

    const result = parse(response)
    expect(result.files).toHaveLength(0)
    expect(result.followUp).toContain("Which styling approach?")
    expect(result.followUp).toContain("Tailwind CSS")
  })

  it("handles text-only response with no tool use", () => {
    const response = {
      id: "msg_4",
      content: [
        { type: "text", text: "Here is an explanation of the code..." },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 80 },
    }

    const result = parse(response)
    expect(result.files).toHaveLength(0)
    expect(result.content).toContain("explanation")
    expect(result.tokensUsed).toBe(130)
  })
})
