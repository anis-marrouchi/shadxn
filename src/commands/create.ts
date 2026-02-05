import { existsSync, promises as fs } from "fs"
import path from "path"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { generate } from "@/src/agent"
import type { ProviderName } from "@/src/agent/providers"
import chalk from "chalk"
import { Command } from "commander"
import ora from "ora"
import prompts from "prompts"

// --- `shadxn create` — template system for scaffolding entire projects ---

interface Template {
  name: string
  description: string
  prompt: string
  skills: string[]
  outputType: string
  tags: string[]
}

const TEMPLATES: Template[] = [
  {
    name: "saas-starter",
    description: "Full-stack SaaS starter with auth, billing, dashboard, and landing page",
    prompt: `Create a full-stack SaaS starter project with:
1. Authentication (sign up, sign in, forgot password, email verification)
2. Billing integration with Stripe (pricing page, checkout, subscription management, webhooks)
3. Dashboard with sidebar navigation, user profile, settings page
4. Landing page with hero, features, pricing, testimonials, FAQ, footer
5. Database schema for users, subscriptions, teams
6. API routes for all CRUD operations
7. Middleware for auth protection
8. Environment variables template`,
    skills: [],
    outputType: "website",
    tags: ["saas", "auth", "billing", "stripe", "dashboard"],
  },
  {
    name: "api-service",
    description: "REST API service with auth, validation, error handling, and tests",
    prompt: `Create a REST API service with:
1. Project structure with routes, controllers, middleware, models, utils
2. Authentication middleware (JWT)
3. Input validation using the project's validation library
4. Centralized error handling with proper HTTP status codes
5. Health check endpoint
6. CRUD endpoints for a sample resource
7. Request logging middleware
8. Rate limiting
9. Environment configuration
10. Test suite for all endpoints`,
    skills: [],
    outputType: "api",
    tags: ["api", "rest", "backend", "auth", "jwt"],
  },
  {
    name: "cli-tool",
    description: "CLI application with commands, flags, interactive prompts, and config",
    prompt: `Create a CLI tool with:
1. Command framework setup (commander or similar)
2. Multiple subcommands with flags and arguments
3. Interactive prompts for user input
4. Configuration file support (read/write)
5. Colored output and spinners
6. Help text and version command
7. Error handling with friendly messages
8. A sample command that demonstrates all features`,
    skills: [],
    outputType: "script",
    tags: ["cli", "tool", "command-line"],
  },
  {
    name: "component-library",
    description: "UI component library with Storybook, tests, and documentation",
    prompt: `Create a UI component library with:
1. Button, Input, Card, Modal, Dropdown, Alert, Badge, Avatar components
2. Consistent theming system (colors, typography, spacing)
3. All components are accessible (ARIA, keyboard navigation)
4. Component props are typed and documented
5. Each component has unit tests
6. Storybook stories for each component
7. Export barrel file
8. Package.json configured for publishing`,
    skills: [],
    outputType: "component",
    tags: ["components", "ui", "library", "storybook"],
  },
  {
    name: "fullstack-app",
    description: "Full-stack application with database, API, UI, and deployment config",
    prompt: `Create a full-stack application with:
1. Database schema with models for a practical app (e.g., task management)
2. API layer with CRUD operations for all models
3. Frontend pages: home, list view, detail view, create/edit forms
4. Authentication flow (login, register, protected routes)
5. Form validation on client and server
6. Loading states and error handling in the UI
7. Docker configuration for development
8. CI/CD workflow for GitHub Actions
9. Environment configuration template`,
    skills: [],
    outputType: "website",
    tags: ["fullstack", "app", "database", "auth"],
  },
  {
    name: "mobile-app",
    description: "Mobile application with navigation, screens, and native features",
    prompt: `Create a mobile application with:
1. Navigation setup (tab navigation + stack navigation)
2. Screens: Home, Profile, Settings, List, Detail
3. Authentication flow (login, register)
4. Theme system with dark mode support
5. State management setup
6. API client configuration
7. Common components (Button, Card, Input, Header)
8. App configuration and assets setup`,
    skills: [],
    outputType: "page",
    tags: ["mobile", "react-native", "expo", "flutter"],
  },
  {
    name: "chrome-extension",
    description: "Browser extension with popup, content script, background worker, and options",
    prompt: `Create a browser extension (Chrome/Firefox compatible) with:
1. manifest.json (Manifest V3)
2. Popup page with UI
3. Content script that modifies web pages
4. Background service worker for event handling
5. Options/settings page
6. Storage management for user preferences
7. Message passing between popup, content script, and background
8. Icons and assets structure
9. Build script`,
    skills: [],
    outputType: "website",
    tags: ["extension", "chrome", "browser", "plugin"],
  },
  {
    name: "data-pipeline",
    description: "Data processing pipeline with ingestion, transformation, and output stages",
    prompt: `Create a data processing pipeline with:
1. Data ingestion from multiple sources (file, API, database)
2. Transformation stage with configurable processors
3. Validation and error handling at each stage
4. Output to multiple destinations (file, database, API)
5. Logging and monitoring
6. Configuration file for pipeline definition
7. CLI runner with progress reporting
8. Test suite with sample data
9. Docker configuration`,
    skills: [],
    outputType: "script",
    tags: ["data", "pipeline", "etl", "processing"],
  },
]

export const create = new Command()
  .name("create")
  .description("scaffold a new project from a template using AI")
  .argument("[name]", "project name")
  .option(
    "-t, --template <template>",
    `template to use: ${TEMPLATES.map((t) => t.name).join(", ")}`
  )
  .option(
    "-p, --provider <provider>",
    "AI provider (claude-code, claude)",
    "claude-code"
  )
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key")
  .option(
    "-c, --cwd <cwd>",
    "parent directory",
    process.cwd()
  )
  .option("--list", "list available templates", false)
  .option("-y, --yes", "skip confirmation prompts", false)
  .action(async (name, opts) => {
    try {
      // List templates
      if (opts.list) {
        logger.break()
        console.log(chalk.bold("  Available templates:"))
        logger.break()
        for (const t of TEMPLATES) {
          console.log(`  ${chalk.green(t.name)}`)
          console.log(`    ${chalk.dim(t.description)}`)
          console.log(
            `    ${chalk.dim("tags:")} ${t.tags.map((tag) => chalk.cyan(tag)).join(", ")}`
          )
          logger.break()
        }
        return
      }

      // Interactive project name
      if (!name) {
        const response = await prompts({
          type: "text",
          name: "name",
          message: "Project name:",
          validate: (v) =>
            v.trim()
              ? /^[a-z0-9-_.]+$/.test(v.trim())
                ? true
                : "Use lowercase letters, numbers, hyphens, dots, or underscores"
              : "Name is required",
        })
        if (!response.name) {
          logger.warn("No name provided. Exiting.")
          process.exit(0)
        }
        name = response.name
      }

      // Select template
      let template: Template | undefined
      if (opts.template) {
        template = TEMPLATES.find((t) => t.name === opts.template)
        if (!template) {
          logger.error(
            `Template "${opts.template}" not found. Available: ${TEMPLATES.map((t) => t.name).join(", ")}`
          )
          logger.info(`Run ${chalk.green("shadxn create --list")} to see all templates.`)
          process.exit(1)
        }
      } else {
        const { selected } = await prompts({
          type: "select",
          name: "selected",
          message: "Choose a template:",
          choices: [
            ...TEMPLATES.map((t) => ({
              title: `${t.name} — ${t.description}`,
              value: t.name,
            })),
            {
              title: "Custom — describe your own project",
              value: "_custom",
            },
          ],
        })

        if (!selected) {
          logger.warn("No template selected. Exiting.")
          process.exit(0)
        }

        if (selected === "_custom") {
          const { description } = await prompts({
            type: "text",
            name: "description",
            message: "Describe the project you want to create:",
            validate: (v) => (v.trim() ? true : "Description is required"),
          })

          if (!description) {
            logger.warn("No description provided. Exiting.")
            process.exit(0)
          }

          template = {
            name: "custom",
            description,
            prompt: description,
            skills: [],
            outputType: "website",
            tags: [],
          }
        } else {
          template = TEMPLATES.find((t) => t.name === selected)!
        }
      }

      // Create project directory
      const projectDir = path.resolve(opts.cwd, name)
      if (existsSync(projectDir)) {
        if (!opts.yes) {
          const { overwrite } = await prompts({
            type: "confirm",
            name: "overwrite",
            message: `Directory "${name}" already exists. Continue?`,
            initial: false,
          })
          if (!overwrite) {
            logger.info("Cancelled.")
            return
          }
        }
      } else {
        await fs.mkdir(projectDir, { recursive: true })
      }

      logger.break()
      logger.info(`Project: ${chalk.bold(name)}`)
      logger.info(`Template: ${chalk.bold(template.name)}`)
      logger.info(`Directory: ${chalk.dim(projectDir)}`)
      logger.break()

      const spinner = ora("Generating project from template...").start()

      const result = await generate({
        task: `Create a new project called "${name}" in the current directory.\n\n${template.prompt}\n\nGenerate all files relative to the project root. Include a README.md explaining the project and how to get started.`,
        outputType: template.outputType as any,
        cwd: projectDir,
        overwrite: true,
        dryRun: false,
        provider: opts.provider as ProviderName,
        model: opts.model,
        apiKey: opts.apiKey,
        context7: true,
        interactive: false,
        maxSteps: 5,
      })

      spinner.stop()

      // Show results
      logger.break()
      if (result.content) {
        console.log(result.content)
        logger.break()
      }

      if (result.files.written.length) {
        logger.success(
          `Created ${result.files.written.length} file(s) in ${chalk.bold(name)}/`
        )
        for (const file of result.files.written) {
          const relative = path.relative(projectDir, file)
          console.log(`  ${chalk.green("+")} ${relative}`)
        }
      }

      if (result.files.errors.length) {
        logger.error(`${result.files.errors.length} file(s) failed:`)
        for (const err of result.files.errors) {
          console.log(`  ${chalk.red("x")} ${err}`)
        }
      }

      logger.break()
      logger.info("Next steps:")
      console.log(`  ${chalk.green("cd")} ${name}`)
      console.log(
        `  ${chalk.green("shadxn inspect")} — see what was generated`
      )
      console.log(
        `  ${chalk.green("shadxn evolve")} — modify and extend`
      )
      logger.break()

      if (result.tokensUsed) {
        logger.info(`Tokens used: ${result.tokensUsed}`)
      }
    } catch (error) {
      handleError(error)
    }
  })
