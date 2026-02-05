import { existsSync, promises as fs } from "fs"
import path from "path"
import { execa } from "execa"
import { createProvider, type ProviderName } from "@/src/agent/providers"
import type { GenerationMessage, GeneratedFile } from "@/src/agent/providers/types"
import { detectTechStack, formatTechStack } from "@/src/agent/context/tech-stack"
import { Memory } from "./memory"

// --- Auto-Heal Engine: detect errors, diagnose, fix, verify ---
// When generated code fails (build error, test failure, runtime crash),
// the heal engine reads the error, understands the context, generates
// a fix, and re-verifies it works.

export interface HealConfig {
  enabled: boolean
  testCommand?: string
  buildCommand?: string
  lintCommand?: string
  maxAttempts: number
  provider: ProviderName
  model?: string
  apiKey?: string
}

export interface HealResult {
  healed: boolean
  attempts: number
  error: string
  fix?: string
  filesChanged: string[]
}

const DEFAULT_HEAL_CONFIG: HealConfig = {
  enabled: true,
  maxAttempts: 3,
  provider: "claude",
}

export class HealEngine {
  private config: HealConfig
  private memory: Memory

  constructor(
    private cwd: string,
    config?: Partial<HealConfig>,
    memory?: Memory
  ) {
    this.config = { ...DEFAULT_HEAL_CONFIG, ...config }
    this.memory = memory || new Memory(cwd)
  }

  async detectAndHeal(
    generatedFiles: string[],
    originalTask: string,
    entryId?: string
  ): Promise<HealResult> {
    if (!this.config.enabled) {
      return { healed: false, attempts: 0, error: "Heal disabled", filesChanged: [] }
    }

    // 1. Run verification commands
    const error = await this.runVerification()
    if (!error) {
      return { healed: true, attempts: 0, error: "", filesChanged: [] }
    }

    // 2. Attempt to heal
    let attempts = 0
    let currentError = error
    const allChangedFiles: string[] = []

    while (attempts < this.config.maxAttempts) {
      attempts++

      const fix = await this.generateFix(
        currentError,
        generatedFiles,
        originalTask,
        attempts
      )

      if (!fix.files.length) {
        break // Agent couldn't generate a fix
      }

      // Apply the fix
      for (const file of fix.files) {
        const filePath = path.isAbsolute(file.path)
          ? file.path
          : path.resolve(this.cwd, file.path)

        const dir = path.dirname(filePath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(filePath, file.content, "utf8")
        allChangedFiles.push(file.path)
      }

      // Re-verify
      const newError = await this.runVerification()
      if (!newError) {
        // Healed successfully
        if (entryId) {
          await this.memory.recordHeal(entryId, error, true, allChangedFiles)
        }
        return {
          healed: true,
          attempts,
          error,
          fix: fix.explanation,
          filesChanged: allChangedFiles,
        }
      }

      currentError = newError
    }

    // Failed to heal
    if (entryId) {
      await this.memory.recordHeal(entryId, error, false, allChangedFiles)
    }

    return {
      healed: false,
      attempts,
      error: currentError,
      filesChanged: allChangedFiles,
    }
  }

  private async runVerification(): Promise<string | null> {
    const commands = [
      this.config.buildCommand,
      this.config.lintCommand,
      this.config.testCommand,
    ].filter(Boolean) as string[]

    // Auto-detect commands if not configured
    if (!commands.length) {
      const detected = await this.detectCommands()
      commands.push(...detected)
    }

    for (const cmd of commands) {
      try {
        const [bin, ...args] = cmd.split(" ")
        await execa(bin, args, {
          cwd: this.cwd,
          timeout: 60000,
          reject: true,
        })
      } catch (error: any) {
        const stderr = error.stderr || ""
        const stdout = error.stdout || ""
        const message = error.message || ""
        return truncateError(`Command failed: ${cmd}\n${stderr}\n${stdout}\n${message}`)
      }
    }

    return null // All passed
  }

  private async detectCommands(): Promise<string[]> {
    const commands: string[] = []
    const pkgPath = path.resolve(this.cwd, "package.json")

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"))
        const scripts = pkg.scripts || {}
        if (scripts.build) commands.push("npm run build")
        if (scripts.typecheck) commands.push("npm run typecheck")
        if (scripts.lint) commands.push("npm run lint")
        if (scripts.test) commands.push("npm run test")
      } catch {
        // Skip if can't read package.json
      }
    }

    // Python projects
    if (existsSync(path.resolve(this.cwd, "pyproject.toml"))) {
      if (existsSync(path.resolve(this.cwd, "conftest.py"))) {
        commands.push("python -m pytest --tb=short -q")
      }
    }

    return commands
  }

  private async generateFix(
    error: string,
    affectedFiles: string[],
    originalTask: string,
    attempt: number
  ): Promise<{ files: GeneratedFile[]; explanation: string }> {
    const provider = createProvider(this.config.provider, this.config.apiKey)

    // Read affected files
    const fileContents: string[] = []
    for (const file of affectedFiles.slice(0, 5)) {
      const filePath = path.resolve(this.cwd, file)
      if (existsSync(filePath)) {
        const content = await fs.readFile(filePath, "utf8")
        fileContents.push(`## ${file}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``)
      }
    }

    const techStack = await detectTechStack(this.cwd)

    const messages: GenerationMessage[] = [
      {
        role: "system",
        content: `You are shadxn auto-heal. You fix errors in generated code.

Project tech stack: ${formatTechStack(techStack)}

RULES:
- Fix ONLY the error — do not refactor or add features
- Output the COMPLETE fixed file content via create_files
- Be minimal — smallest change that fixes the error
- This is attempt ${attempt} — ${attempt > 1 ? "previous fix attempts failed, try a different approach" : "analyze carefully"}`,
      },
      {
        role: "user",
        content: `The following code was generated for task: "${originalTask}"

## Error
\`\`\`
${error}
\`\`\`

## Affected Files
${fileContents.join("\n\n")}

Fix the error. Use create_files with the corrected file content.`,
      },
    ]

    const result = await provider.generate(messages, {
      model: this.config.model,
      maxTokens: 8192,
    })

    return {
      files: result.files,
      explanation: result.content,
    }
  }
}

function truncateError(error: string): string {
  const lines = error.split("\n").filter((l) => l.trim())
  if (lines.length > 30) {
    return lines.slice(0, 30).join("\n") + "\n... (truncated)"
  }
  return lines.join("\n")
}
