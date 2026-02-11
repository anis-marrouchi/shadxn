import chalk from "chalk"

// Minimal, dependency-free markdown pretty-printer for terminal output.
// Goal: improve readability of plans/specs without trying to fully parse Markdown.

function indentBlock(s: string, prefix: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => (l.length ? prefix + l : l))
    .join("\n")
}

function renderInline(line: string): string {
  // Inline code
  line = line.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code))
  // Links: [text](url) -> text (url)
  line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `${text} ${chalk.dim(`(${url})`)}`)
  // Bold (**text**). Keep this last-ish to avoid interfering with code/link replacements.
  line = line.replace(/\*\*([^*]+)\*\*/g, (_, t) => chalk.bold(t))
  return line
}

function renderTextBlock(block: string): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (/^\s*#{1,6}\s+/.test(line)) {
      const title = line.replace(/^\s*#{1,6}\s+/, "")
      out.push(chalk.bold(renderInline(title)))
      continue
    }

    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      out.push(chalk.dim("─".repeat(40)))
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      out.push(chalk.dim("│ ") + renderInline(line.replace(/^\s*>\s?/, "")))
      continue
    }

    out.push(renderInline(line))
  }

  return out.join("\n")
}

export function renderMarkdownForTerminal(md: string): string {
  const input = (md || "").replace(/\r\n/g, "\n")
  if (!input.trim()) return ""

  // Split by fenced code blocks. Keep fences so output still looks like markdown,
  // but dim the code body to reduce noise for plan/spec output.
  const parts = input.split(/```/g)
  if (parts.length === 1) return renderTextBlock(input)

  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i]
    const isCode = i % 2 === 1

    if (!isCode) {
      out.push(renderTextBlock(chunk))
      continue
    }

    // chunk starts with optional "lang\n"
    const firstNl = chunk.indexOf("\n")
    const info = firstNl === -1 ? chunk.trim() : chunk.slice(0, firstNl).trim()
    const body = firstNl === -1 ? "" : chunk.slice(firstNl + 1)

    const header = info ? chalk.dim("```" + info) : chalk.dim("```")
    const footer = chalk.dim("```")
    const codeBody = chalk.dim(indentBlock(body.replace(/\s+$/g, ""), ""))

    out.push([header, codeBody, footer].filter(Boolean).join("\n"))
  }

  // Avoid leading/trailing empty lines noise.
  return out.join("\n").replace(/^\n+|\n+$/g, "")
}

