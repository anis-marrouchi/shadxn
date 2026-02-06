# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**shadxn** is an AI-powered agentic code generation CLI tool and framework. It generates components, pages, APIs, documents, skills, and more using Claude as the default AI provider. It evolved from shadcn-ui into a full generation framework supporting any tech stack.

Published to npm as `shadxn` with bin aliases: `shadxn`, `shadxn-ui`, `shadxn-cli`, `ui`.

## Commands

```bash
pnpm build          # Build with tsup (ESM, minified, sourcemaps → dist/)
pnpm dev            # Build in watch mode
pnpm test           # Run tests with vitest
pnpm typecheck      # Type-check without emitting
pnpm format:check   # Check formatting with prettier
pnpm format:write   # Fix formatting
pnpm clean          # Remove dist/ and components/
```

Run the CLI locally after building: `node dist/index.js <command>`

## Architecture

### Entry Point & CLI

`src/index.ts` — Commander-based CLI with these command groups:

**Core commands** (the agentic generation system):
- `generate` / `gen` / `g` — AI-powered file generation from natural language
- `evolve` / `ev` — Transform existing files with diff preview
- `create` — Scaffold projects from 8 curated templates
- `run` — HTTP runtime server with learning pipeline
- `inspect` / `info` — Analyze project tech stack and schemas
- `skill` — Manage reusable instruction sets (skills.sh compatible)
- `serve` — Run as MCP server (stdio transport, JSON-RPC 2.0)

**Legacy commands** (original shadcn registry features): `init`, `add`, `diff`, `registry`

### Agent Orchestrator (`src/agent/`)

The core generation flow coordinated by `src/agent/index.ts`:

1. **Context gathering** (parallel): tech stack detection, schema discovery, skill loading
2. **System prompt construction**: combines detected context, matched skills, and output type instructions
3. **Multi-step agentic loop**: up to 5 iterations, provider signals continuation via `[CONTINUE]` token
4. **File deduplication & writing**: later steps override earlier files at the same path

Key subdirectories:
- `providers/` — Pluggable AI backends. `AgentProvider` interface in `types.ts`. Implementations: `claude-code.ts` (uses Claude subscription via `execa`), `claude.ts` (direct API, needs `ANTHROPIC_API_KEY`)
- `context/` — `tech-stack.ts` detects 30+ languages and 25+ frameworks from config files. `schema.ts` discovers DB/API/env schemas. `context7.ts` fetches live library docs
- `skills/` — Skill loading, matching (keyword + tag + glob + content similarity), registry install from skills.sh/GitHub, AI-powered skill generation
- `outputs/` — 15 output types with auto-detection via regex patterns, project-aware file path resolution

### Runtime Framework (`src/runtime/`)

HTTP server with middleware pipeline (Express/Laravel-like):
```
Request → Memory → Context → Generate → Heal → Record → Enhance → Response
```
- `memory.ts` — Persistent JSON store at `.shadxn/memory.json` tracking generations, patterns, preferences
- `heal.ts` — Auto-detect build/test failures, generate fixes, re-verify
- `enhance.ts` — Distill patterns into reusable skills

### MCP Server (`src/mcp/`)

Exposes 4 tools via JSON-RPC 2.0 over stdio: `shadxn_generate`, `shadxn_inspect`, `shadxn_skill_match`, `shadxn_detect_output_type`.

### Legacy Registry System (`src/registries/`, `src/utils/`)

Original shadcn-ui component registry, config resolution, and code transformers (Babel/ts-morph/recast). Tests in `test/` cover these legacy commands.

## Provider System

Default provider is `claude-code` (uses Claude subscription, no API key). The `claude` provider requires `ANTHROPIC_API_KEY`. Provider is selected via `--provider` flag or `shadxn.config.json`. Default model: `claude-sonnet-4-20250514`.

## Configuration

Runtime config in `shadxn.config.json` at project root. Skills are loaded from `.skills/`, `.claude/skills/`, `skills/`, or root `SKILL.md`.

## Build & Module System

- **ESM only** (`"type": "module"` in package.json)
- **tsup** bundles `src/index.ts` → `dist/index.js`
- **Path aliases**: `@/src/*` mapped via tsconfig `paths` (resolved by `tsconfig-paths` at runtime, `vite-tsconfig-paths` in tests)
- **Zod** for all schema validation (agent config, output types)
