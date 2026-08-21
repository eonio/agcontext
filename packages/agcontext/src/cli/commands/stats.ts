import type { Command } from "commander";
import pc from "picocolors";
import { formatBytes, formatMs, heading, table } from "../format.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

export function registerStatsCommand(program: Command, ctx: CliContext): void {
  program
    .command("stats")
    .description("Index, graph, cache, and telemetry statistics")
    .action(async (_options: unknown, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const stats = await app.stats();
      if (globals.json === true) {
        ctx.io.out(JSON.stringify(stats, null, 2));
        return;
      }

      ctx.io.out(heading(`agcontext v${stats.version}`) + ` ${pc.dim(stats.root)}`);
      if (!stats.indexed || !stats.meta) {
        ctx.io.out(pc.yellow('not indexed yet — run "agc index"'));
        return;
      }
      const meta = stats.meta;
      ctx.io.out(
        `index: ${meta.stats.files} files, ${meta.stats.symbols} symbols — built ${meta.indexedAt} in ${formatMs(meta.durationMs)}` +
          (meta.stats.incremental ? " (incremental)" : ""),
      );
      if (stats.graph) {
        ctx.io.out(`graph: ${stats.graph.nodes} nodes, ${stats.graph.edges} edges`);
      }
      ctx.io.out(
        `retrieval: ${meta.stats.chunks} chunks, ${meta.stats.embeddedChunks} embedded — ` +
          `strategy=${stats.strategy}, embeddings=${stats.embedProvider}` +
          (stats.generateProvider !== undefined ? `, generation=${stats.generateProvider}` : ""),
      );
      if (stats.plugins.length > 0) ctx.io.out(`plugins: ${stats.plugins.join(", ")}`);

      const sizes = Object.entries(stats.cacheSizes);
      if (sizes.length > 0) {
        ctx.io.out("");
        ctx.io.out(
          table(
            ["cache file", "size"],
            sizes.map(([name, size]) => [name, formatBytes(size)]),
          ),
        );
      }

      const telemetryEntries = Object.entries(stats.telemetry);
      if (telemetryEntries.length > 0) {
        ctx.io.out("");
        ctx.io.out(
          table(
            ["telemetry event", "count", "avg", "max"],
            telemetryEntries.map(([name, entry]) => [
              name,
              String(entry.count),
              formatMs(entry.avgMs),
              formatMs(entry.maxMs),
            ]),
          ),
        );
      }
    });
}
