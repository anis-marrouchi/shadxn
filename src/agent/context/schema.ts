import { existsSync, promises as fs } from "fs"
import path from "path"
import fg from "fast-glob"

// --- Schema awareness: detect DB schemas, API specs, env vars, configs ---

export interface ProjectSchemas {
  database?: DatabaseSchema
  api?: ApiSchema
  env?: EnvSchema
  models?: ModelFile[]
}

export interface DatabaseSchema {
  type: string // prisma, drizzle, typeorm, etc.
  content: string
  tables?: string[]
}

export interface ApiSchema {
  type: string // openapi, graphql, trpc, etc.
  content: string
  endpoints?: string[]
}

export interface EnvSchema {
  variables: { key: string; description?: string; required: boolean }[]
}

export interface ModelFile {
  path: string
  content: string
  type: string
}

const SCHEMA_FILES: Record<string, { type: string; category: "database" | "api" | "model" }> = {
  "prisma/schema.prisma": { type: "prisma", category: "database" },
  "drizzle/schema.ts": { type: "drizzle", category: "database" },
  "schema.graphql": { type: "graphql", category: "api" },
  "schema.gql": { type: "graphql", category: "api" },
  "openapi.yaml": { type: "openapi", category: "api" },
  "openapi.json": { type: "openapi", category: "api" },
  "swagger.yaml": { type: "openapi", category: "api" },
  "swagger.json": { type: "openapi", category: "api" },
}

export async function detectSchemas(cwd: string): Promise<ProjectSchemas> {
  const schemas: ProjectSchemas = {}

  // Find schema files
  const files = await fg.glob("**/*", {
    cwd,
    deep: 4,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/target/**",
      "**/__pycache__/**",
      "**/vendor/**",
      "**/.git/**",
    ],
    onlyFiles: true,
  })

  // Detect database schemas
  for (const [schemaFile, info] of Object.entries(SCHEMA_FILES)) {
    const match = files.find((f) => f.endsWith(schemaFile) || f === schemaFile)
    if (match && info.category === "database") {
      const content = await safeReadFile(path.resolve(cwd, match))
      if (content) {
        schemas.database = {
          type: info.type,
          content: truncate(content, 3000),
          tables: extractTableNames(content, info.type),
        }
        break
      }
    }
  }

  // Detect API schemas
  for (const [schemaFile, info] of Object.entries(SCHEMA_FILES)) {
    const match = files.find((f) => f.endsWith(schemaFile) || f === schemaFile)
    if (match && info.category === "api") {
      const content = await safeReadFile(path.resolve(cwd, match))
      if (content) {
        schemas.api = {
          type: info.type,
          content: truncate(content, 3000),
        }
        break
      }
    }
  }

  // Detect tRPC router
  if (!schemas.api) {
    const trpcRouter = files.find(
      (f) => f.includes("trpc") && (f.endsWith("router.ts") || f.endsWith("router.js"))
    )
    if (trpcRouter) {
      const content = await safeReadFile(path.resolve(cwd, trpcRouter))
      if (content) {
        schemas.api = {
          type: "trpc",
          content: truncate(content, 3000),
        }
      }
    }
  }

  // Detect env variables
  const envExample = files.find(
    (f) => f === ".env.example" || f === ".env.local.example" || f === ".env.template"
  )
  if (envExample) {
    const content = await safeReadFile(path.resolve(cwd, envExample))
    if (content) {
      schemas.env = parseEnvFile(content)
    }
  }

  // Detect model/type files
  const modelFiles = files.filter(
    (f) =>
      (f.includes("models") || f.includes("types") || f.includes("schemas")) &&
      (f.endsWith(".ts") || f.endsWith(".py") || f.endsWith(".rs") || f.endsWith(".go"))
  )

  if (modelFiles.length) {
    schemas.models = []
    for (const mf of modelFiles.slice(0, 5)) {
      const content = await safeReadFile(path.resolve(cwd, mf))
      if (content) {
        schemas.models.push({
          path: mf,
          content: truncate(content, 2000),
          type: path.extname(mf).slice(1),
        })
      }
    }
  }

  return schemas
}

function extractTableNames(content: string, type: string): string[] {
  if (type === "prisma") {
    const matches = content.match(/model\s+(\w+)\s*\{/g)
    return matches ? matches.map((m) => m.replace(/model\s+/, "").replace(/\s*\{/, "")) : []
  }
  return []
}

function parseEnvFile(content: string): EnvSchema {
  const lines = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"))
  const variables = lines.map((line) => {
    const [keyPart] = line.split("=")
    const key = keyPart.trim()
    const hasValue = line.includes("=") && line.split("=")[1]?.trim().length > 0
    return {
      key,
      required: !hasValue,
    }
  })
  return { variables }
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    if (!existsSync(filePath)) return null
    return await fs.readFile(filePath, "utf8")
  } catch {
    return null
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + "\n... (truncated)"
}

export function formatSchemas(schemas: ProjectSchemas): string {
  const sections: string[] = []

  if (schemas.database) {
    sections.push(
      `## Database Schema (${schemas.database.type})\n` +
        (schemas.database.tables?.length
          ? `Tables: ${schemas.database.tables.join(", ")}\n`
          : "") +
        "```\n" +
        schemas.database.content +
        "\n```"
    )
  }

  if (schemas.api) {
    sections.push(
      `## API Schema (${schemas.api.type})\n` + "```\n" + schemas.api.content + "\n```"
    )
  }

  if (schemas.env) {
    sections.push(
      `## Environment Variables\n` +
        schemas.env.variables.map((v) => `- ${v.key}${v.required ? " (required)" : ""}`).join("\n")
    )
  }

  if (schemas.models?.length) {
    for (const model of schemas.models) {
      sections.push(
        `## Model: ${model.path}\n` + "```" + model.type + "\n" + model.content + "\n```"
      )
    }
  }

  return sections.join("\n\n")
}
