import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { ProviderRegistry } from "../../providers/registry.js";
import { CliFailure } from "../io.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

const CONFIG_TEMPLATE = `import { defineConfig } from "@eonio/agcontext";

export default defineConfig({
  // Retrieval
  strategy: "hybrid", // hybrid | graph | lexical | semantic
  graphDepth: 2, // graph expansion hops from retrieval seeds
  maxNodes: 50, // nodes considered for context assembly
  ranking: "hybrid", // hybrid (weighted multi-signal) | rrf

  // Providers — "auto" resolves from the environment:
  //   ANTHROPIC_API_KEY, OPENAI_API_KEY, AZURE_OPENAI_API_KEY,
  //   GOOGLE_API_KEY, OPENROUTER_API_KEY
  provider: "auto",
  embeddingProvider: "auto", // falls back to offline "local" embeddings

  context: {
    maxTokens: 12000,
    format: "markdown", // markdown | xml | json
  },

  // telemetry: { enabled: true }, // local-only metrics, opt-in
});
`;

export function registerInitCommand(program: Command, ctx: CliContext): void {
  program
    .command("init")
    .description("Scaffold agcontext.config.ts and prepare the workspace")
    .option("--force", "overwrite an existing config file")
    .action(async (options: { force?: boolean }, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const cwd = path.resolve(globals.cwd ?? process.cwd());
      const configPath = path.join(cwd, "agcontext.config.ts");

      if (existsSync(configPath) && options.force !== true) {
        throw new CliFailure(
          `agcontext.config.ts already exists in ${cwd} (use --force to overwrite).`,
        );
      }
      await writeFile(configPath, CONFIG_TEMPLATE, "utf8");
      ctx.io.err(`${pc.green("created")} agcontext.config.ts`);

      /* Keep the index cache out of version control. */
      const gitignorePath = path.join(cwd, ".gitignore");
      const ignoreEntry = "# AGContext index cache\n.agcontext/\n";
      if (existsSync(gitignorePath)) {
        const current = await readFile(gitignorePath, "utf8");
        if (!current.includes(".agcontext")) {
          await appendFile(gitignorePath, `\n${ignoreEntry}`, "utf8");
          ctx.io.err(`${pc.green("updated")} .gitignore (+ .agcontext/)`);
        }
      } else if (existsSync(path.join(cwd, ".git"))) {
        await writeFile(gitignorePath, ignoreEntry, "utf8");
        ctx.io.err(`${pc.green("created")} .gitignore (.agcontext/)`);
      }

      const configured = new ProviderRegistry()
        .detect()
        .filter((row) => row.configured && row.name !== "local");
      if (configured.length > 0) {
        ctx.io.err(`providers detected: ${configured.map((row) => row.name).join(", ")}`);
      } else {
        ctx.io.err(
          "no provider API keys detected — AGContext runs fully offline with local embeddings; " +
            "set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY for higher-quality retrieval",
        );
      }

      ctx.io.err("");
      ctx.io.err("next steps:");
      ctx.io.err(`  1. ${pc.bold("agc index")}       build the code graph and retrieval index`);
      ctx.io.err(`  2. ${pc.bold('agc retrieve "your question"')}`);
      ctx.io.err(`  3. ${pc.bold('agc context "your question" --format xml')}`);
    });
}
