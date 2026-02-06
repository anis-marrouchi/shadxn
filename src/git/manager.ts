import { execa } from "execa"
import type { GitStatus, GitLogEntry, GitDiffFile, GitCommitResult } from "./types"

// --- Git Manager: wraps git operations via execa ---

export class GitManager {
  constructor(private cwd: string) {}

  /**
   * Check if the current directory is a git repository.
   */
  async isRepo(): Promise<boolean> {
    try {
      await execa("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: this.cwd,
        reject: false,
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get current git status.
   */
  async status(): Promise<GitStatus> {
    const result = await execa("git", ["status", "--porcelain", "-b"], {
      cwd: this.cwd,
      reject: false,
    })

    const lines = result.stdout.trim().split("\n").filter(Boolean)
    let branch = "unknown"
    const staged: string[] = []
    const modified: string[] = []
    const untracked: string[] = []
    const deleted: string[] = []

    for (const line of lines) {
      // Branch line: ## main...origin/main
      if (line.startsWith("## ")) {
        branch = line.slice(3).split("...")[0]
        continue
      }

      const indexStatus = line[0]
      const workStatus = line[1]
      const file = line.slice(3).trim()

      // Staged changes (index column)
      if (indexStatus === "A" || indexStatus === "M" || indexStatus === "R") {
        staged.push(file)
      }
      if (indexStatus === "D") {
        deleted.push(file)
        staged.push(file)
      }

      // Unstaged changes (working tree column)
      if (workStatus === "M") {
        modified.push(file)
      }
      if (workStatus === "D") {
        deleted.push(file)
      }

      // Untracked
      if (indexStatus === "?" && workStatus === "?") {
        untracked.push(file)
      }
    }

    return {
      staged,
      modified,
      untracked,
      deleted: [...new Set(deleted)],
      branch,
      isClean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
    }
  }

  /**
   * Get git diff (staged or unstaged).
   */
  async diff(staged = false): Promise<string> {
    const args = staged ? ["diff", "--cached"] : ["diff"]
    const result = await execa("git", args, {
      cwd: this.cwd,
      reject: false,
    })
    return result.stdout
  }

  /**
   * Get diff summary with file-level stats.
   */
  async diffStat(staged = false): Promise<GitDiffFile[]> {
    const args = staged
      ? ["diff", "--cached", "--numstat"]
      : ["diff", "--numstat"]

    const result = await execa("git", args, {
      cwd: this.cwd,
      reject: false,
    })

    const files: GitDiffFile[] = []
    for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
      const [additions, deletions, path] = line.split("\t")
      if (!path) continue

      let status: GitDiffFile["status"] = "modified"
      if (additions === "-" && deletions === "-") {
        status = "renamed" // binary or renamed
      }

      files.push({
        path,
        status,
        additions: parseInt(additions) || 0,
        deletions: parseInt(deletions) || 0,
      })
    }

    return files
  }

  /**
   * Get recent git log entries.
   */
  async log(count = 10): Promise<GitLogEntry[]> {
    const result = await execa(
      "git",
      ["log", `--max-count=${count}`, "--format=%H|%h|%s|%an|%ai"],
      {
        cwd: this.cwd,
        reject: false,
      }
    )

    if (!result.stdout.trim()) return []

    return result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, message, author, date] = line.split("|")
        return { hash, shortHash, message, author, date }
      })
  }

  /**
   * Stage files.
   */
  async add(files: string[]): Promise<void> {
    if (!files.length) return
    await execa("git", ["add", ...files], { cwd: this.cwd })
  }

  /**
   * Stage all changes.
   */
  async addAll(): Promise<void> {
    await execa("git", ["add", "-A"], { cwd: this.cwd })
  }

  /**
   * Commit with a message.
   */
  async commit(message: string): Promise<GitCommitResult> {
    const result = await execa("git", ["commit", "-m", message], {
      cwd: this.cwd,
      reject: false,
    })

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "Git commit failed")
    }

    // Parse commit hash from output
    const hashMatch = result.stdout.match(/\[[\w/.-]+\s+(\w+)\]/)
    const hash = hashMatch?.[1] || "unknown"

    // Count files changed
    const filesMatch = result.stdout.match(/(\d+)\s+files?\s+changed/)
    const filesChanged = parseInt(filesMatch?.[1] || "0")

    return { hash, message, filesChanged }
  }

  /**
   * Get current branch name.
   */
  async currentBranch(): Promise<string> {
    const result = await execa("git", ["branch", "--show-current"], {
      cwd: this.cwd,
      reject: false,
    })
    return result.stdout.trim()
  }

  /**
   * Create and switch to a new branch.
   */
  async createBranch(name: string): Promise<void> {
    await execa("git", ["checkout", "-b", name], { cwd: this.cwd })
  }

  /**
   * Switch to an existing branch.
   */
  async checkout(name: string): Promise<void> {
    await execa("git", ["checkout", name], { cwd: this.cwd })
  }

  /**
   * Stash current changes.
   */
  async stash(message?: string): Promise<void> {
    const args = ["stash", "push"]
    if (message) args.push("-m", message)
    await execa("git", args, { cwd: this.cwd })
  }

  /**
   * Pop the latest stash.
   */
  async stashPop(): Promise<void> {
    await execa("git", ["stash", "pop"], { cwd: this.cwd })
  }

  /**
   * Generate an AI commit message from staged changes.
   * Returns a conventional commit message based on the diff.
   */
  async generateCommitMessage(provider?: {
    generate: (messages: any[], options?: any) => Promise<any>
  }): Promise<string> {
    const diff = await this.diff(true)
    if (!diff.trim()) {
      throw new Error("No staged changes to commit")
    }

    if (!provider) {
      // Fallback: generate from diff summary
      return this.fallbackCommitMessage(diff)
    }

    const result = await provider.generate([
      {
        role: "system",
        content: `You are a git commit message generator. Generate a conventional commit message (type(scope): subject) from the given diff.
Rules:
- Use conventional commit format: feat|fix|refactor|docs|test|chore|style(scope): message
- Keep the subject line under 72 characters
- Be specific about what changed
- Output ONLY the commit message, nothing else`,
      },
      {
        role: "user",
        content: `Generate a commit message for this diff:\n\n${diff.slice(0, 4000)}`,
      },
    ])

    return result.content.trim().split("\n")[0]
  }

  private fallbackCommitMessage(diff: string): string {
    const lines = diff.split("\n")
    const fileChanges: string[] = []

    for (const line of lines) {
      if (line.startsWith("diff --git")) {
        const match = line.match(/b\/(.+)$/)
        if (match) fileChanges.push(match[1])
      }
    }

    if (fileChanges.length === 0) return "chore: update files"
    if (fileChanges.length === 1) return `chore: update ${fileChanges[0]}`
    return `chore: update ${fileChanges.length} files`
  }
}
