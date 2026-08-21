import type { Command } from "commander";
import pc from "picocolors";
import { formatMs, resultTable } from "../format.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

export function registerSearchCommand(program: Command, ctx: CliContext): void {
  program
    .command("search")
    .argument("<query>", "search query")
    .description("Fast lexical search over the index (no API calls, no expansion)")
    .option("-n, --limit <count>", "number of results", (value) => Number.parseInt(value, 10))
    .action(async (query: string, options: { limit?: number }, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const result = await app.search({
        query,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
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
      ctx.io.err(
        pc.dim(
          `${result.items.length} results in ${formatMs(result.diagnostics.totalMs)} (lexical)`,
        ),
      );
    });
}
