
# shadxn

The agentic generation tool — generate components, pages, APIs, docs, skills, and more using AI. Default agent: Claude. Supports any tech stack.

`shadxn` started as an experimental CLI built on `shadcn-ui`. It has evolved into a universal agentic code generation tool that understands your project, loads skills, fetches live documentation, and generates production-ready output for **any** tech stack — not just React.

## What it does

- **Generate anything** — components, pages, APIs, websites, documents, scripts, configs, agent skills, media prompts, reports
- **Any tech stack** — detects 30+ languages and 25+ frameworks automatically (Next.js, Nuxt, SvelteKit, Django, Rails, FastAPI, Flutter, Go, Rust...)
- **Claude as default agent** — uses Anthropic's Claude with tool use to generate files and ask clarifying questions when needed
- **Schema-aware** — reads your Prisma schemas, GraphQL specs, OpenAPI definitions, tRPC routers, env files, and model types
- **Context7 integration** — fetches up-to-date library documentation so generated code uses current APIs, not stale patterns
- **skills.sh compatible** — install community skills or create your own. Skills are reusable SKILL.md files that teach the agent domain-specific patterns
- **Backwards compatible** — all original commands (`init`, `add`, `diff`, `registry`) still work for component registry management

## Acknowledgment

This project builds on the original `Shadcn UI` CLI. We are deeply grateful to `Shadcn` and all contributors for their foundational work.

- **Project:** Shadcn UI
- **Author:** [Shadcn](https://twitter.com/shadcn)
- **License:** MIT
- **Source:** [https://github.com/shadcn-ui/ui](https://github.com/shadcn-ui/ui)

## Installation

```bash
# npm
npm install -g shadxn

# pnpm
pnpm add -g shadxn

# yarn
yarn global add shadxn

# bun
bun add -g shadxn

# or run directly with npx
npx shadxn [command]
```

## Quick start

```bash
# Generate a component
npx shadxn generate "a responsive pricing card with toggle for monthly/yearly"

# Generate an API endpoint
npx shadxn gen "REST API for user authentication with JWT" --type api

# Generate a full page
npx shadxn g "admin dashboard with charts and data table" --type page

# Generate a document
npx shadxn generate "OpenAPI specification for a todo app" --type document

# Generate a skill
npx shadxn generate "how to create accessible form components" --type skill
```

## Commands

```
Usage: shadxn [options] [command]

Options:
  -v, --version                  display the version number
  -h, --help                     display help for command

Commands:
  generate [options] [task...]   generate anything using AI (aliases: gen, g)
  evolve [options] [task...]     modify existing code using AI (aliases: ev, transform)
  create [options] [name]        scaffold a new project from a template using AI
  inspect [options]              show what the agent knows about your project (aliases: info, ctx)
  skill                          manage agent skills — install, create, list, inspect
  serve [options]                run as MCP server for AI editors (Claude Code, Cursor, etc.)
  init [options]                 initialize your project and install dependencies
  add [options] [components...]  add components from selected registries
  diff [options] [component]     check for component updates against the registry
  registry <action> [project]    manage the project's component registry
  help [command]                 display help for command
```

### `shadxn generate`

The core command. Describe what you want and the agent builds it.

```bash
shadxn generate "a dashboard with user stats and charts"
```

**Options:**

| Flag | Description |
|---|---|
| `-t, --type <type>` | Output type: `component`, `page`, `api`, `website`, `document`, `script`, `config`, `skill`, `media`, `report`, `test`, `workflow`, `schema`, `email`, `diagram`, `auto` |
| `-o, --output <dir>` | Output directory |
| `--overwrite` | Overwrite existing files |
| `--dry-run` | Preview without writing files |
| `-p, --provider <name>` | AI provider (`claude`, `openai`, `ollama`) |
| `-m, --model <model>` | Model to use |
| `--api-key <key>` | API key for the provider |
| `--max-steps <n>` | Max agentic loop steps for complex generation (default: 5) |
| `-c, --cwd <cwd>` | Working directory |
| `--no-context7` | Disable Context7 doc lookup |
| `-y, --yes` | Skip confirmation prompts |

**How it works (multi-step agentic loop):**

1. Detects your tech stack (languages, frameworks, databases, styling, testing, deployment)
2. Reads project schemas (Prisma, GraphQL, OpenAPI, tRPC, env vars, model files)
3. Loads matching skills from `.skills/` directory
4. Fetches relevant library documentation via Context7
5. Sends everything to Claude with your task description
6. **Agentic loop**: Claude generates files, then evaluates if more are needed. For complex tasks (e.g., "full-stack todo app"), it chains steps — schema first, then API referencing the schema, then UI calling the API, then tests covering everything
7. Files are deduplicated and written to the appropriate directory based on output type and project structure

### `shadxn evolve`

Modify existing code using AI. Unlike `generate` (which creates new files), `evolve` reads your existing files, transforms them, and shows a diff preview before writing.

```bash
# Add dark mode to all components
shadxn evolve "add dark mode support" --glob "src/components/**/*.tsx"

# Convert REST calls to tRPC
shadxn evolve "migrate API calls to tRPC" --glob "src/app/**"

# Add accessibility
shadxn evolve "add ARIA attributes and keyboard navigation" --glob "src/components/forms/**"

# Internationalize
shadxn evolve "add i18n with next-intl, extract hardcoded strings" --glob "src/**/*.tsx"
```

**Options:**

| Flag | Description |
|---|---|
| `-g, --glob <pattern>` | Glob pattern for files to evolve |
| `--max-files <n>` | Max files to process (default: 10) |
| `-p, --provider <name>` | AI provider |
| `-m, --model <model>` | Model to use |
| `--api-key <key>` | API key |
| `-c, --cwd <cwd>` | Working directory |
| `--no-context7` | Disable Context7 |
| `-y, --yes` | Apply all changes without confirmation |
| `--dry-run` | Show proposed changes without writing |

Each changed file shows a colored diff preview with accept/skip/quit controls.

### `shadxn inspect`

Show what the agent knows about your project — before generating anything.

```bash
shadxn inspect
```

```
  shadxn inspect
  /path/to/your/project

  Languages
    ● typescript (tsconfig.json)

  Frameworks
    ● nextjs [fullstack]
    ● react @^18.2.0 [frontend]

  Databases
    ● prisma (5 tables: User, Post, Comment, Tag, Session)

  Styling
    ● tailwindcss

  Testing
    ● vitest

  Skills
    ● form-validation [local]
    ● api-patterns [intellectronica/agent-skills]

  Dependencies
    ● 42 dependencies, 15 devDependencies

  Summary: 1 lang(s) · 2 framework(s) · schemas detected · 2 skill(s)
```

**Options:** `--json` (machine-readable output), `--verbose` (show full schema contents)

### `shadxn create`

Scaffold entire projects from curated templates using AI.

```bash
# List available templates
shadxn create --list

# Create from a template
shadxn create my-app --template saas-starter
shadxn create my-api --template api-service
shadxn create my-cli --template cli-tool

# Custom project (describe your own)
shadxn create my-project
# → Choose "Custom" and describe what you want
```

**Available templates:**

| Template | Description |
|---|---|
| `saas-starter` | Full-stack SaaS with auth, billing (Stripe), dashboard, landing page |
| `api-service` | REST API with auth, validation, error handling, tests |
| `cli-tool` | CLI app with commands, prompts, config, colored output |
| `component-library` | UI component library with Storybook, tests, docs |
| `fullstack-app` | Full-stack app with database, API, UI, Docker, CI/CD |
| `mobile-app` | Mobile app with navigation, screens, theming, auth |
| `chrome-extension` | Browser extension (Manifest V3) with popup, content script, background |
| `data-pipeline` | Data processing pipeline with ingestion, transformation, output |

Templates use the multi-step agentic loop — the agent scaffolds foundations first, then builds each layer on top.

### `shadxn serve`

Run shadxn as an MCP (Model Context Protocol) server so AI editors can use it as a tool.

```bash
# Start MCP server (stdio transport)
shadxn serve --stdio
```

**Add to Claude Code:**

```bash
claude mcp add shadxn -- npx shadxn serve --stdio
```

**Add to Cursor / MCP config:**

```json
{
  "mcpServers": {
    "shadxn": {
      "command": "npx",
      "args": ["shadxn", "serve", "--stdio"]
    }
  }
}
```

**Exposed MCP tools:**

| Tool | Description |
|---|---|
| `shadxn_generate` | Generate code, components, APIs, docs — with full project context |
| `shadxn_inspect` | Analyze project tech stack, schemas, skills |
| `shadxn_skill_match` | Find relevant skills for a task |
| `shadxn_detect_output_type` | Auto-detect output type from description |

This turns any MCP-compatible editor into a shadxn-powered generator.

### `shadxn skill`

Manage agent skills — reusable instruction sets that teach the agent domain-specific patterns.

```bash
# Install a skill package from skills.sh or GitHub
shadxn skill install intellectronica/agent-skills

# Create a new skill (AI-generated based on your tech stack)
shadxn skill create form-validation

# Create a blank skill template
shadxn skill create my-skill --no-ai

# List installed skills
shadxn skill list

# View skill details
shadxn skill inspect form-validation
```

Skills are SKILL.md files with YAML frontmatter, following the [Agent Skills](https://skills.sh) specification:

```markdown
---
name: form-validation
description: Generate accessible form components with validation
tags:
  - forms
  - validation
  - accessibility
---

# Form Validation Skill

## Instructions

When creating form components:
1. Use the project's form library (react-hook-form, formik, etc.)
2. Add Zod schemas for validation
3. Include proper ARIA attributes
4. Show inline error messages
...
```

Skills are automatically matched to tasks based on triggers, tags, and content overlap.

### Legacy commands

These original commands continue to work for component registry management:

```bash
# Initialize project for component registries
npx shadxn init

# Add a component from a registry
npx shadxn add button

# Add from a schema URL
npx shadxn add "https://www.prismui.tech/r/styles/default/expandable-card.json"

# Add a v0 component
npx shadxn add "https://v0.dev/chat/b/b_ODuOFQMZViC"

# Manage custom registries
npx shadxn registry init
npx shadxn registry build
npx shadxn registry activate my-registry
```

## Configuration

### API key

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or pass it inline:

```bash
shadxn generate "..." --api-key sk-ant-...
```

### Project detection

shadxn automatically detects your project's:

- **Languages** — TypeScript, Python, Rust, Go, Ruby, PHP, Java, Kotlin, Swift, Dart, Elixir, C/C++, and more
- **Frameworks** — Next.js, Nuxt, SvelteKit, Astro, Remix, Angular, Vue, Express, Fastify, Hono, Django, Rails, Laravel, FastAPI, Flutter, Expo, Electron, Tauri...
- **Databases** — Prisma, Drizzle, TypeORM, Knex, Supabase, Firebase
- **Styling** — Tailwind CSS, PostCSS, Stylelint, styled-components
- **Testing** — Vitest, Jest, Cypress, Playwright, Mocha, pytest
- **Deployment** — Vercel, Netlify, Docker, Fly.io, Railway, GitHub Actions, Terraform
- **Package managers** — npm, pnpm, yarn, bun
- **Monorepos** — Turborepo, Nx, Lerna, pnpm workspaces

### Output types

| Type | Description |
|---|---|
| `component` | UI component (any framework) |
| `page` | Full page or screen |
| `api` | API endpoint, route handler, or service |
| `website` | Multi-page website or app |
| `document` | Markdown, documentation, or specification |
| `script` | Standalone script or utility |
| `config` | Configuration file or setup |
| `skill` | Agent skill (SKILL.md format) |
| `media` | Media generation prompt (image/audio/video description) |
| `report` | Analysis report or audit |
| `test` | Test suite, test fixtures, or test data |
| `workflow` | CI/CD pipeline, GitHub Actions, or automation |
| `schema` | Database schema, Zod validators, or GraphQL types |
| `email` | Email template (React Email, MJML, HTML) |
| `diagram` | Mermaid, D2, or PlantUML diagram |
| `auto` | Auto-detect from task description (default) |

## Architecture

```
src/
├── agent/
│   ├── index.ts                 # Orchestrator — coordinates the full pipeline
│   ├── providers/
│   │   ├── types.ts             # Provider abstraction + config schema
│   │   ├── claude.ts            # Claude provider (default)
│   │   └── index.ts             # Provider factory
│   ├── context/
│   │   ├── tech-stack.ts        # Universal tech stack detection
│   │   ├── schema.ts            # Schema awareness (DB, API, env, models)
│   │   └── context7.ts          # Context7 live documentation
│   ├── skills/
│   │   ├── types.ts             # Skill schema (skills.sh compatible)
│   │   ├── loader.ts            # Load + match skills to tasks
│   │   ├── registry.ts          # skills.sh install + GitHub fallback
│   │   └── generator.ts         # AI-powered skill creation
│   └── outputs/
│       ├── types.ts             # Output type definitions + auto-detection
│       └── handlers.ts          # File writing with project-aware paths
├── mcp/
│   └── index.ts                 # MCP server (stdio transport, JSON-RPC)
├── commands/
│   ├── generate.ts              # `shadxn generate` command
│   ├── evolve.ts                # `shadxn evolve` command
│   ├── create.ts                # `shadxn create` command (templates)
│   ├── inspect.ts               # `shadxn inspect` command
│   ├── skill.ts                 # `shadxn skill` command
│   ├── serve.ts                 # `shadxn serve` command (MCP)
│   ├── init.ts                  # Legacy: project initialization
│   ├── add.ts                   # Legacy: add components from registries
│   ├── diff.ts                  # Legacy: check for updates
│   └── registry.ts              # Legacy: manage registries
├── registries/                  # Component registry definitions
└── utils/                       # Shared utilities
```

## Extending

### Adding a provider

Implement the `AgentProvider` interface in `src/agent/providers/`:

```typescript
interface AgentProvider {
  name: string
  generate(messages: GenerationMessage[], options?: ProviderOptions): Promise<GenerationResult>
}
```

### Creating skills

Skills are the composable building blocks. Create them manually or let the AI generate them:

```bash
# AI generates a skill based on your tech stack
shadxn skill create api-patterns -d "RESTful API patterns with error handling"

# Install community skills
shadxn skill install owner/repo
```

## License

`shadxn` is licensed under the [MIT license](https://github.com/anis-marrouchi/shadxn/blob/main/LICENSE.md).
