import { existsSync, promises as fs } from "fs"
import path from "path"
import type { GeneratedFile } from "../providers/types"
import type { TechStack } from "../context/tech-stack"
import { OUTPUT_CONFIGS } from "./types"
import { logger } from "@/utils/logger"
import { globalHooks } from "@/hooks"
import { globalPermissions } from "@/permissions"

// --- Write generated files to disk ---

export interface WriteOptions {
  cwd: string
  overwrite: boolean
  dryRun: boolean
  outputDir?: string
}

export interface WriteResult {
  written: string[]
  skipped: string[]
  errors: string[]
}

export async function writeGeneratedFiles(
  files: GeneratedFile[],
  options: WriteOptions
): Promise<WriteResult> {
  const result: WriteResult = { written: [], skipped: [], errors: [] }

  for (const file of files) {
    const filePath = path.isAbsolute(file.path)
      ? file.path
      : path.resolve(options.cwd, options.outputDir || "", file.path)

    try {
      // pre:file-write hook — can block or modify file content
      let fileContent = file.content
      if (globalHooks.has("pre:file-write")) {
        const hookResult = await globalHooks.execute("pre:file-write", {
          event: "pre:file-write",
          file: filePath,
          fileContent,
          cwd: options.cwd,
        })
        if (hookResult.blocked) {
          result.skipped.push(filePath)
          continue
        }
        if (hookResult.modified?.fileContent) {
          fileContent = String(hookResult.modified.fileContent)
        }
      }

      // Permissions check — can allow, deny, or skip (plan mode)
      const relativePath = path.relative(options.cwd, filePath)
      const permission = await globalPermissions.checkFileWrite(relativePath)
      if (permission === "deny") {
        result.skipped.push(filePath)
        continue
      }
      if (permission === "skip") {
        // Plan mode: record what would be written but don't write
        result.written.push(filePath)
        continue
      }

      if (existsSync(filePath) && !options.overwrite) {
        result.skipped.push(filePath)
        continue
      }

      if (options.dryRun) {
        result.written.push(filePath)
        continue
      }

      // Create directory structure
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      // Write file
      await fs.writeFile(filePath, fileContent, "utf8")
      result.written.push(filePath)

      // post:file-write hook — post-processing (format, git add, etc.)
      if (globalHooks.has("post:file-write")) {
        await globalHooks.execute("post:file-write", {
          event: "post:file-write",
          file: filePath,
          fileContent,
          cwd: options.cwd,
        })
      }
    } catch (error: any) {
      result.errors.push(`${filePath}: ${error.message}`)
    }
  }

  return result
}

export function resolveOutputDir(
  outputType: string,
  stack: TechStack,
  customDir?: string
): string {
  if (customDir) return customDir

  const config = OUTPUT_CONFIGS[outputType]
  if (!config) return "generated"

  // Adjust base dir based on project structure
  let baseDir = config.baseDir

  if (outputType === "component") {
    // Detect existing component directory
    if (stack.srcDir) {
      baseDir = `${stack.srcDir}/components`
    } else {
      baseDir = "components"
    }
  }

  if (outputType === "page") {
    // Detect app dir structure
    const hasAppDir =
      stack.frameworks.find((f) => f.name === "nextjs") && stack.srcDir
    if (hasAppDir) {
      baseDir = `${stack.srcDir}/app`
    }
  }

  if (outputType === "api") {
    const isNextJs = stack.frameworks.find((f) => f.name === "nextjs")
    if (isNextJs) {
      baseDir = stack.srcDir ? `${stack.srcDir}/app/api` : "app/api"
    }
  }

  if (outputType === "test") {
    if (stack.testing.includes("vitest") || stack.testing.includes("jest")) {
      baseDir = stack.srcDir || "src"
    }
  }

  if (outputType === "workflow") {
    baseDir = ".github/workflows"
  }

  if (outputType === "schema") {
    if (stack.databases.includes("prisma")) {
      baseDir = "prisma"
    } else if (stack.srcDir) {
      baseDir = `${stack.srcDir}/schemas`
    }
  }

  if (outputType === "email") {
    baseDir = stack.srcDir ? `${stack.srcDir}/emails` : "emails"
  }

  return baseDir
}
