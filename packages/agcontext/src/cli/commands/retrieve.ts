import type { Command } from "commander";
import pc from "picocolors";
import type { RetrievalStrategy } from "../../core/types.js";
import { formatMs, resultTable } from "../format.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

interface RetrieveCommandOptions {
  limit?: number;
  strategy?: RetrievalStrategy;
  depth?: number;
}

export function registerRetrieveCommand(program: Command, ctx: CliContext): void {
  program
    .command("retrieve")
    .argument("<query>", "retrieval query")
    .description("Full hybrid retrieval: lexical + semantic + graph expansion + ranking")
    .option("-n, --limit <count>", "number of results", (value) => Number.parseInt(value, 10))
    .option("-s, --strategy <strategy>", "hybrid | graph | lexical | semantic")
    .option("-d, --depth <hops>", "graph expansion depth", (value) => Number.parseInt(value, 10))
    .action(async (query: string, options: RetrieveCommandOptions, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const result = await app.retrieve({
        query,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
        ...(options.depth !== undefined ? { graphDepth: options.depth } : {}),
      });
      if (globals.json === true) {
        ctx.io.out(JSON.stringify(result, null, 2));
        return;
      }
      if (result.items.length === 0) {
        ctx.io.out(pc.dim("no matches"));
        return;
      }
      ctx.io.out(resultTable(result.items));
      const d = result.diagnostics;
      const stages = Object.entries(d.timings)
        .map(([stage, ms]) => `${stage} ${formatMs(ms)}`)
        .join(", ");
      ctx.io.err(
        pc.dim(
          `${result.items.length}/${d.candidateCount} candidates in ${formatMs(d.totalMs)} ` +
            `[${d.strategy}; seeds=${d.seedCount}, expanded=${d.expandedCount}, embeddings=${d.embeddingUsed ? "on" : "off"}] (${stages})`,
        ),
      );
    });
}
