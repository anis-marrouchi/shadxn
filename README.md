# shadxn

A monorepo with two packages. We're experimenting with AI — building our way into the unknown, hoping we'll learn how to master its use along the way.

## Packages

### `agentx`

General-purpose agentic code generation engine. CLI and library.

Takes a natural language task, gathers project context (tech stack, schemas, skills, library docs), sends it to Claude, and writes the output files. Supports multi-step generation, auto-healing, a runtime server, MCP server mode, REPL, git integration, and agent-to-agent communication.

```bash
agentx generate "REST API for user auth with JWT"
agentx evolve "add dark mode" --glob "src/components/**/*.tsx"
agentx chat
agentx inspect
agentx serve --stdio
```

### `shadxn`

Component registry and code transform system. Originally forked from shadcn-ui.

Manages component registries (shadcn, aceternity, custom), handles AST transforms for imports/CSS/JSX/RSC, and resolves project config. Depends on `agentx` for shared utilities.

```bash
shadxn init
shadxn add button
shadxn diff
shadxn registry build
```

## Setup

```bash
pnpm install
pnpm build
```

## Development

```bash
pnpm dev            # watch mode (both packages)
pnpm build          # build (agentx first, then shadxn via turbo)
pnpm test           # run tests
pnpm typecheck      # type-check
```

Run locally after building:

```bash
node packages/agentx/dist/cli.js generate "hello world"
node packages/shadxn/dist/cli.js init
```

## Structure

```
packages/
  agentx/           agent orchestrator, providers, context, skills,
                    outputs, tools, runtime, MCP, memory, hooks,
                    observability, permissions, REPL, git, A2A
  shadxn/           registries, AST transformers, config resolution,
                    component commands (init, add, diff, registry)
```

## Acknowledgment

The shadxn package builds on the original [Shadcn UI](https://github.com/shadcn-ui/ui) CLI by [Shadcn](https://twitter.com/shadcn). MIT licensed.

## License

MIT
