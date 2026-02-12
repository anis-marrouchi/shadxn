# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**shadxn** is an AI-powered design system tool — component registry, AST transforms, and styling for any tech stack. It evolved from shadcn-ui, providing multi-registry component installation, code transformations, and project scaffolding.

Published to npm as `shadxn` with bin aliases: `shadxn`, `shadxn-ui`, `shadxn-cli`, `ui`.

## Commands

```bash
pnpm build          # Build with tsup (ESM, minified, sourcemaps → dist/)
pnpm dev            # Build in watch mode
pnpm test           # Run tests with vitest
pnpm typecheck      # Type-check without emitting
pnpm format:check   # Check formatting with prettier
pnpm format:write   # Fix formatting
pnpm clean          # Remove dist/
```

Run the CLI locally after building: `node dist/cli.js <command>`

## Architecture

### Entry Point & CLI

`src/cli.ts` — Commander-based CLI with these commands:

- `init` — Initialize project config and install dependencies
- `add` — Add components from registries to your project
- `diff` — Check for updates against the registry
- `registry` — Manage the project registry

### Public Library API (`src/index.ts`)

Exports registry utilities, transformers, config resolution, project info, and templates for programmatic use.

### Registry System (`src/registries/`, `src/utils/`)

Multi-registry component system supporting shadcn, aceternity, and magic-ui registries:

- `src/utils/registry/` — Registry fetching, tree resolution, base colors, schema validation
- `src/utils/transformers/` — Code transformers (Babel/ts-morph/recast) for import rewriting, CSS variable injection, RSC transforms, Tailwind prefix handling
- `src/utils/get-config.ts` — Project config resolution from `components.json`
- `src/utils/get-project-info.ts` — Detect project type (Next.js, Remix, Gatsby, etc.)
- `src/utils/get-package-manager.ts` — Auto-detect npm/yarn/pnpm/bun
- `src/utils/resolve-import.ts` — Resolve TypeScript path aliases

### Commands (`src/commands/`)

- `init.ts` — Interactive setup: detect project type, configure paths, install dependencies
- `add.ts` — Fetch components from registry, transform imports/styles, write to project
- `diff.ts` — Compare local components against registry versions
- `registry.ts` — Build and manage local component registries

## Configuration

Project config in `components.json` at project root, created by `shadxn init`.

## Build & Module System

- **ESM only** (`"type": "module"` in package.json)
- **tsup** bundles `src/index.ts` + `src/cli.ts` → `dist/`
- **Path aliases**: `@/*` mapped to `./src/*` via tsconfig `paths` (resolved by `tsconfig-paths` at runtime, `vite-tsconfig-paths` in tests)
- **Zod** for schema validation (config, registry)

## Testing

Tests in `test/` cover commands and utilities using vitest with mocked fs/execa. Fixtures in `test/fixtures/` provide sample configs and project structures.
