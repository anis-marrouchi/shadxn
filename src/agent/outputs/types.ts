import type { OutputType } from "../providers/types"

// --- Output type resolution and file path mapping ---

export interface OutputConfig {
  type: OutputType
  baseDir: string
  filePatterns: string[]
  description: string
}

export const OUTPUT_CONFIGS: Record<string, OutputConfig> = {
  component: {
    type: "component",
    baseDir: "src/components",
    filePatterns: ["*.tsx", "*.vue", "*.svelte", "*.jsx", "*.ts"],
    description: "UI component",
  },
  page: {
    type: "page",
    baseDir: "src/app",
    filePatterns: ["*.tsx", "*.vue", "*.svelte", "*.jsx", "*.astro"],
    description: "Page or screen",
  },
  api: {
    type: "api",
    baseDir: "src/api",
    filePatterns: ["*.ts", "*.js", "*.py", "*.go", "*.rs"],
    description: "API route or endpoint",
  },
  website: {
    type: "website",
    baseDir: ".",
    filePatterns: ["*"],
    description: "Multi-file website",
  },
  document: {
    type: "document",
    baseDir: "docs",
    filePatterns: ["*.md", "*.mdx", "*.txt", "*.rst"],
    description: "Documentation",
  },
  script: {
    type: "script",
    baseDir: "scripts",
    filePatterns: ["*.ts", "*.js", "*.py", "*.sh", "*.go"],
    description: "Standalone script",
  },
  config: {
    type: "config",
    baseDir: ".",
    filePatterns: ["*.json", "*.yaml", "*.yml", "*.toml", "*.env"],
    description: "Configuration file",
  },
  skill: {
    type: "skill",
    baseDir: ".skills",
    filePatterns: ["SKILL.md"],
    description: "Agent skill (SKILL.md)",
  },
  media: {
    type: "media",
    baseDir: "media",
    filePatterns: ["*.md", "*.json", "*.txt"],
    description: "Media generation prompt/description",
  },
  report: {
    type: "report",
    baseDir: "reports",
    filePatterns: ["*.md", "*.html", "*.json"],
    description: "Analysis report",
  },
}

export function resolveOutputType(
  userHint: string | undefined,
  taskDescription: string
): OutputType {
  if (userHint && userHint !== "auto") {
    return userHint as OutputType
  }

  const lower = taskDescription.toLowerCase()

  // Pattern matching for output type detection
  const patterns: [RegExp, OutputType][] = [
    [/\b(component|button|card|modal|dialog|form|input|dropdown|nav|sidebar|header|footer|widget|ui)\b/i, "component"],
    [/\b(page|screen|view|route|layout|dashboard|landing)\b/i, "page"],
    [/\b(api|endpoint|route handler|rest|graphql|webhook|middleware|server)\b/i, "api"],
    [/\b(website|site|web app|landing page|portfolio|blog)\b/i, "website"],
    [/\b(document|doc|readme|guide|tutorial|specification|spec|changelog)\b/i, "document"],
    [/\b(script|cli|command|tool|utility|migration|seed|cron)\b/i, "script"],
    [/\b(config|configuration|setup|env|settings)\b/i, "config"],
    [/\b(skill|agent skill|skill\.md)\b/i, "skill"],
    [/\b(video|audio|image|media|animation|thumbnail|podcast)\b/i, "media"],
    [/\b(report|audit|analysis|review|assessment|benchmark)\b/i, "report"],
  ]

  for (const [pattern, type] of patterns) {
    if (pattern.test(lower)) {
      return type
    }
  }

  return "component" // Default fallback
}
