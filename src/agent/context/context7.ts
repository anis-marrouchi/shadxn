import fetch from "node-fetch"
import { logger } from "@/src/utils/logger"
import type { TechStack } from "./tech-stack"

// --- Context7 integration: fetch up-to-date library documentation ---

const CONTEXT7_API = "https://api.context7.com/v1"

interface Context7Library {
  id: string
  name: string
  description?: string
}

interface Context7Docs {
  libraryId: string
  content: string
  tokens: number
}

export async function resolveLibraryId(
  libraryName: string,
  apiKey?: string
): Promise<Context7Library | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

    const response = await fetch(`${CONTEXT7_API}/libraries/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: libraryName }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as any
    if (data?.libraries?.length) {
      return data.libraries[0]
    }
    return null
  } catch {
    return null
  }
}

export async function getLibraryDocs(
  libraryId: string,
  topic?: string,
  maxTokens: number = 5000,
  apiKey?: string
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

    const response = await fetch(`${CONTEXT7_API}/libraries/${encodeURIComponent(libraryId)}/docs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ topic, maxTokens }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as any
    return data?.content || null
  } catch {
    return null
  }
}

export async function gatherContext7Docs(
  stack: TechStack,
  topic: string,
  apiKey?: string
): Promise<string> {
  const relevantLibraries: string[] = []

  // Gather the most important frameworks and libraries
  for (const fw of stack.frameworks.slice(0, 3)) {
    relevantLibraries.push(fw.name)
  }

  // Add key dependencies
  const priorityDeps = [
    "react",
    "vue",
    "svelte",
    "angular",
    "next",
    "nuxt",
    "express",
    "fastify",
    "hono",
    "prisma",
    "drizzle-orm",
    "tailwindcss",
    "shadcn",
    "@tanstack/react-query",
    "zod",
    "trpc",
  ]

  for (const dep of priorityDeps) {
    if (stack.dependencies[dep] || stack.devDependencies[dep]) {
      if (!relevantLibraries.includes(dep)) {
        relevantLibraries.push(dep)
      }
    }
  }

  const docs: string[] = []

  for (const lib of relevantLibraries.slice(0, 5)) {
    const library = await resolveLibraryId(lib, apiKey)
    if (library) {
      const content = await getLibraryDocs(library.id, topic, 3000, apiKey)
      if (content) {
        docs.push(`## ${library.name} Documentation\n${content}`)
      }
    }
  }

  if (!docs.length) {
    return ""
  }

  return `# Relevant Library Documentation (via Context7)\n\n${docs.join("\n\n---\n\n")}`
}
