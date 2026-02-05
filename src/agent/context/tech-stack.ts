import { existsSync, promises as fs } from "fs"
import path from "path"
import fg from "fast-glob"

// --- Tech stack detection for any language/framework ---

export interface TechStack {
  languages: Language[]
  frameworks: Framework[]
  packageManager?: string
  databases: string[]
  styling: string[]
  testing: string[]
  deployment: string[]
  monorepo: boolean
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
  projectRoot: string
  srcDir: string | null
  configFiles: string[]
}

export interface Language {
  name: string
  version?: string
  configFile?: string
}

export interface Framework {
  name: string
  version?: string
  type: "frontend" | "backend" | "fullstack" | "mobile" | "cli" | "library"
}

const CONFIG_SIGNATURES: Record<string, { language: string; framework?: string; type?: Framework["type"] }> = {
  "package.json": { language: "javascript" },
  "tsconfig.json": { language: "typescript" },
  "requirements.txt": { language: "python" },
  "pyproject.toml": { language: "python" },
  "setup.py": { language: "python" },
  "Pipfile": { language: "python" },
  "Cargo.toml": { language: "rust" },
  "go.mod": { language: "go" },
  "Gemfile": { language: "ruby" },
  "composer.json": { language: "php" },
  "build.gradle": { language: "java" },
  "build.gradle.kts": { language: "kotlin" },
  "pom.xml": { language: "java" },
  "pubspec.yaml": { language: "dart", framework: "flutter", type: "mobile" },
  "Package.swift": { language: "swift" },
  "Makefile": { language: "c" },
  "CMakeLists.txt": { language: "cpp" },
  "mix.exs": { language: "elixir" },
  "deno.json": { language: "typescript", framework: "deno" },
  "bun.lockb": { language: "typescript" },
}

const FRAMEWORK_SIGNATURES: Record<string, { name: string; type: Framework["type"] }> = {
  "next.config.js": { name: "nextjs", type: "fullstack" },
  "next.config.ts": { name: "nextjs", type: "fullstack" },
  "next.config.mjs": { name: "nextjs", type: "fullstack" },
  "nuxt.config.ts": { name: "nuxt", type: "fullstack" },
  "nuxt.config.js": { name: "nuxt", type: "fullstack" },
  "svelte.config.js": { name: "sveltekit", type: "fullstack" },
  "astro.config.mjs": { name: "astro", type: "frontend" },
  "astro.config.ts": { name: "astro", type: "frontend" },
  "remix.config.js": { name: "remix", type: "fullstack" },
  "angular.json": { name: "angular", type: "frontend" },
  "vue.config.js": { name: "vue-cli", type: "frontend" },
  "vite.config.ts": { name: "vite", type: "frontend" },
  "vite.config.js": { name: "vite", type: "frontend" },
  "gatsby-config.js": { name: "gatsby", type: "frontend" },
  "gatsby-config.ts": { name: "gatsby", type: "frontend" },
  "eleventy.config.js": { name: "eleventy", type: "frontend" },
  "docusaurus.config.js": { name: "docusaurus", type: "frontend" },
  "expo-env.d.ts": { name: "expo", type: "mobile" },
  "app.json": { name: "expo", type: "mobile" }, // Could also be other things
  "fastapi": { name: "fastapi", type: "backend" },
  "manage.py": { name: "django", type: "fullstack" },
  "config/routes.rb": { name: "rails", type: "fullstack" },
  "artisan": { name: "laravel", type: "fullstack" },
  "main.go": { name: "go-app", type: "backend" },
  "Dockerfile": { name: "docker", type: "backend" },
}

const DB_SIGNATURES: Record<string, string> = {
  "prisma/schema.prisma": "prisma",
  "drizzle.config.ts": "drizzle",
  "drizzle.config.js": "drizzle",
  "knexfile.js": "knex",
  "knexfile.ts": "knex",
  "ormconfig.json": "typeorm",
  "mikro-orm.config.ts": "mikro-orm",
  "supabase/config.toml": "supabase",
  "firebase.json": "firebase",
  "mongod.conf": "mongodb",
}

const STYLING_SIGNATURES: Record<string, string> = {
  "tailwind.config.js": "tailwindcss",
  "tailwind.config.ts": "tailwindcss",
  "postcss.config.js": "postcss",
  "postcss.config.mjs": "postcss",
  ".stylelintrc": "stylelint",
  "styled-components": "styled-components",
}

const TESTING_SIGNATURES: Record<string, string> = {
  "jest.config.js": "jest",
  "jest.config.ts": "jest",
  "vitest.config.ts": "vitest",
  "vitest.config.js": "vitest",
  "cypress.config.ts": "cypress",
  "cypress.config.js": "cypress",
  "playwright.config.ts": "playwright",
  "playwright.config.js": "playwright",
  ".mocharc.yml": "mocha",
  "pytest.ini": "pytest",
  "conftest.py": "pytest",
}

const DEPLOYMENT_SIGNATURES: Record<string, string> = {
  "vercel.json": "vercel",
  "netlify.toml": "netlify",
  "fly.toml": "fly.io",
  "railway.toml": "railway",
  "render.yaml": "render",
  "Dockerfile": "docker",
  "docker-compose.yml": "docker-compose",
  "docker-compose.yaml": "docker-compose",
  ".github/workflows": "github-actions",
  "serverless.yml": "serverless",
  "terraform": "terraform",
  "pulumi": "pulumi",
}

const MONOREPO_SIGNATURES = [
  "pnpm-workspace.yaml",
  "lerna.json",
  "nx.json",
  "turbo.json",
  "rush.json",
]

const PACKAGE_MANAGER_LOCKS: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
}

export async function detectTechStack(cwd: string): Promise<TechStack> {
  const files = await fg.glob("**/*", {
    cwd,
    deep: 3,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.nuxt/**",
      "**/target/**",
      "**/__pycache__/**",
      "**/vendor/**",
      "**/.git/**",
    ],
    onlyFiles: true,
  })

  const languages = detectLanguages(files, cwd)
  const frameworks = await detectFrameworks(files, cwd)
  const packageManager = detectPackageManager(files)
  const databases = detectDatabases(files)
  const styling = detectStyling(files)
  const testing = detectTesting(files)
  const deployment = detectDeployment(files)
  const monorepo = detectMonorepo(files)
  const { dependencies, devDependencies, scripts } = await readPackageJson(cwd)
  const srcDir = existsSync(path.resolve(cwd, "src")) ? "src" : null
  const configFiles = files.filter(
    (f) =>
      f.endsWith(".json") ||
      f.endsWith(".yaml") ||
      f.endsWith(".yml") ||
      f.endsWith(".toml") ||
      f.endsWith(".config.js") ||
      f.endsWith(".config.ts") ||
      f.endsWith(".config.mjs")
  )

  // Enrich frameworks from package.json dependencies
  enrichFrameworksFromDeps(frameworks, dependencies, devDependencies)

  return {
    languages,
    frameworks,
    packageManager,
    databases,
    styling,
    testing,
    deployment,
    monorepo,
    dependencies,
    devDependencies,
    scripts,
    projectRoot: cwd,
    srcDir,
    configFiles,
  }
}

function detectLanguages(files: string[], cwd: string): Language[] {
  const langs = new Map<string, Language>()

  for (const [configFile, { language }] of Object.entries(CONFIG_SIGNATURES)) {
    if (files.includes(configFile)) {
      if (!langs.has(language)) {
        langs.set(language, { name: language, configFile })
      }
    }
  }

  // Detect from file extensions
  const extMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".rb": "ruby",
    ".php": "php",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".dart": "dart",
    ".ex": "elixir",
    ".exs": "elixir",
    ".c": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".lua": "lua",
    ".zig": "zig",
    ".v": "vlang",
  }

  for (const file of files) {
    const ext = path.extname(file)
    if (extMap[ext] && !langs.has(extMap[ext])) {
      langs.set(extMap[ext], { name: extMap[ext] })
    }
  }

  return Array.from(langs.values())
}

async function detectFrameworks(files: string[], cwd: string): Promise<Framework[]> {
  const frameworks = new Map<string, Framework>()

  for (const [file, { name, type }] of Object.entries(FRAMEWORK_SIGNATURES)) {
    if (files.includes(file)) {
      if (!frameworks.has(name)) {
        frameworks.set(name, { name, type })
      }
    }
  }

  return Array.from(frameworks.values())
}

function enrichFrameworksFromDeps(
  frameworks: Framework[],
  deps: Record<string, string>,
  devDeps: Record<string, string>
) {
  const allDeps = { ...deps, ...devDeps }
  const depFrameworks: Record<string, { name: string; type: Framework["type"] }> = {
    react: { name: "react", type: "frontend" },
    vue: { name: "vue", type: "frontend" },
    svelte: { name: "svelte", type: "frontend" },
    "@angular/core": { name: "angular", type: "frontend" },
    express: { name: "express", type: "backend" },
    fastify: { name: "fastify", type: "backend" },
    hono: { name: "hono", type: "backend" },
    "socket.io": { name: "socket.io", type: "backend" },
    electron: { name: "electron", type: "frontend" },
    tauri: { name: "tauri", type: "frontend" },
    "react-native": { name: "react-native", type: "mobile" },
    "@capacitor/core": { name: "capacitor", type: "mobile" },
    ionic: { name: "ionic", type: "mobile" },
    three: { name: "threejs", type: "frontend" },
    d3: { name: "d3", type: "library" },
    "@langchain/core": { name: "langchain", type: "library" },
    "ai": { name: "vercel-ai-sdk", type: "library" },
    "@anthropic-ai/sdk": { name: "anthropic-sdk", type: "library" },
    openai: { name: "openai-sdk", type: "library" },
  }

  for (const [dep, info] of Object.entries(depFrameworks)) {
    if (allDeps[dep] && !frameworks.find((f) => f.name === info.name)) {
      frameworks.push({ ...info, version: allDeps[dep] })
    }
  }
}

function detectPackageManager(files: string[]): string | undefined {
  for (const [lockFile, pm] of Object.entries(PACKAGE_MANAGER_LOCKS)) {
    if (files.includes(lockFile)) {
      return pm
    }
  }
  return undefined
}

function detectDatabases(files: string[]): string[] {
  const dbs = new Set<string>()
  for (const [file, db] of Object.entries(DB_SIGNATURES)) {
    if (files.some((f) => f.includes(file))) {
      dbs.add(db)
    }
  }
  return Array.from(dbs)
}

function detectStyling(files: string[]): string[] {
  const styles = new Set<string>()
  for (const [file, style] of Object.entries(STYLING_SIGNATURES)) {
    if (files.includes(file)) {
      styles.add(style)
    }
  }
  return Array.from(styles)
}

function detectTesting(files: string[]): string[] {
  const tests = new Set<string>()
  for (const [file, test] of Object.entries(TESTING_SIGNATURES)) {
    if (files.some((f) => f.includes(file))) {
      tests.add(test)
    }
  }
  return Array.from(tests)
}

function detectDeployment(files: string[]): string[] {
  const deploys = new Set<string>()
  for (const [file, deploy] of Object.entries(DEPLOYMENT_SIGNATURES)) {
    if (files.some((f) => f.includes(file))) {
      deploys.add(deploy)
    }
  }
  return Array.from(deploys)
}

function detectMonorepo(files: string[]): boolean {
  return MONOREPO_SIGNATURES.some((sig) => files.includes(sig))
}

async function readPackageJson(cwd: string): Promise<{
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}> {
  const pkgPath = path.resolve(cwd, "package.json")
  if (!existsSync(pkgPath)) {
    return { dependencies: {}, devDependencies: {}, scripts: {} }
  }

  try {
    const content = await fs.readFile(pkgPath, "utf8")
    const pkg = JSON.parse(content)
    return {
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      scripts: pkg.scripts || {},
    }
  } catch {
    return { dependencies: {}, devDependencies: {}, scripts: {} }
  }
}

export function formatTechStack(stack: TechStack): string {
  const lines: string[] = []

  if (stack.languages.length) {
    lines.push(`Languages: ${stack.languages.map((l) => l.name).join(", ")}`)
  }
  if (stack.frameworks.length) {
    lines.push(
      `Frameworks: ${stack.frameworks.map((f) => `${f.name}${f.version ? `@${f.version}` : ""} (${f.type})`).join(", ")}`
    )
  }
  if (stack.packageManager) {
    lines.push(`Package Manager: ${stack.packageManager}`)
  }
  if (stack.databases.length) {
    lines.push(`Databases: ${stack.databases.join(", ")}`)
  }
  if (stack.styling.length) {
    lines.push(`Styling: ${stack.styling.join(", ")}`)
  }
  if (stack.testing.length) {
    lines.push(`Testing: ${stack.testing.join(", ")}`)
  }
  if (stack.deployment.length) {
    lines.push(`Deployment: ${stack.deployment.join(", ")}`)
  }
  if (stack.monorepo) {
    lines.push(`Monorepo: yes`)
  }
  if (stack.srcDir) {
    lines.push(`Source Dir: ${stack.srcDir}`)
  }

  return lines.join("\n")
}
