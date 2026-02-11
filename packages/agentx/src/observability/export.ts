// --- Session export: convert a session to readable markdown ---

import type { Session } from "@/repl/session"
import type { UsageSummary } from "./tracker"

export function exportSession(session: Session, usage?: UsageSummary): string {
  const lines: string[] = []

  // Header
  lines.push(`# Session: ${session.id}`)
  lines.push("")
  lines.push(`- **Created**: ${session.createdAt}`)
  lines.push(`- **Updated**: ${session.updatedAt}`)
  lines.push(`- **CWD**: ${session.cwd}`)
  lines.push(`- **Messages**: ${session.messages.length}`)
  lines.push(`- **Tokens**: ${session.tokensUsed.toLocaleString()}`)
  lines.push("")

  // Files generated
  if (session.filesGenerated.length) {
    lines.push("## Files Generated")
    lines.push("")
    for (const file of session.filesGenerated) {
      lines.push(`- \`${file}\``)
    }
    lines.push("")
  }

  // Conversation
  if (session.messages.length) {
    lines.push("## Conversation")
    lines.push("")
    for (const msg of session.messages) {
      if (msg.role === "system") continue
      const label = msg.role === "user" ? "**User**" : "**Assistant**"
      lines.push(`### ${label}`)
      lines.push("")
      if (msg.role === "assistant") {
        lines.push(msg.content)
      } else {
        lines.push(msg.content)
      }
      lines.push("")
    }
  }

  // Cost summary
  if (usage) {
    lines.push("## Cost Summary")
    lines.push("")
    lines.push(`- **Total tokens**: ${usage.totalTokens.toLocaleString()}`)
    lines.push(`  - Input: ${usage.totalInputTokens.toLocaleString()}`)
    lines.push(`  - Output: ${usage.totalOutputTokens.toLocaleString()}`)
    lines.push(`- **Total cost**: $${usage.totalCost.toFixed(4)}`)
    lines.push("")

    if (Object.keys(usage.models).length) {
      lines.push("### Per Model")
      lines.push("")
      lines.push("| Model | Input | Output | Cost | Steps |")
      lines.push("|-------|-------|--------|------|-------|")
      for (const [model, mu] of Object.entries(usage.models)) {
        lines.push(
          `| ${model} | ${mu.inputTokens.toLocaleString()} | ${mu.outputTokens.toLocaleString()} | $${mu.cost.toFixed(4)} | ${mu.steps} |`
        )
      }
      lines.push("")
    }

    if (usage.steps.length) {
      lines.push("### Per Step")
      lines.push("")
      lines.push("| Step | Model | Input | Output | Cost |")
      lines.push("|------|-------|-------|--------|------|")
      for (const step of usage.steps) {
        lines.push(
          `| ${step.step} | ${step.model} | ${step.inputTokens.toLocaleString()} | ${step.outputTokens.toLocaleString()} | $${step.cost.toFixed(4)} |`
        )
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}
