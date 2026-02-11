import { Command } from "commander"
import { A2AServer } from "@/a2a"
import type { ProviderName } from "@/agent/providers"

export const a2a = new Command()
  .name("a2a")
  .description("start an A2A (Agent-to-Agent) protocol server for external agent integration")
  .option("--port <port>", "server port", "3171")
  .option("--host <host>", "server host", "0.0.0.0")
  .option("-p, --provider <provider>", "AI provider", "claude-code")
  .option("-m, --model <model>", "model to use")
  .option("--api-key <key>", "API key for the provider")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--no-cors", "disable CORS headers")
  .action(async (opts) => {
    const server = new A2AServer({
      port: parseInt(opts.port, 10),
      host: opts.host,
      provider: opts.provider as ProviderName,
      model: opts.model,
      apiKey: opts.apiKey,
      cwd: opts.cwd,
      cors: opts.cors !== false,
    })

    await server.start()
  })
