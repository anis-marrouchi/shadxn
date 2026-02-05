import { existsSync, promises as fs } from "fs"
import path from "path"
import type { GeneratedFile } from "../providers/types"
import type { TechStack } from "../context/tech-stack"
import { OUTPUT_CONFIGS } from "./types"
import { logger } from "@/src/utils/logger"

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
      await fs.writeFile(filePath, file.content, "utf8")
      result.written.push(filePath)
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

  return baseDir
}
