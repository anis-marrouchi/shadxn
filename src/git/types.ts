// --- Git types ---

export interface GitStatus {
  staged: string[]
  modified: string[]
  untracked: string[]
  deleted: string[]
  branch: string
  isClean: boolean
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

export interface GitDiffFile {
  path: string
  status: "added" | "modified" | "deleted" | "renamed"
  additions: number
  deletions: number
}

export interface GitCommitResult {
  hash: string
  message: string
  filesChanged: number
}
