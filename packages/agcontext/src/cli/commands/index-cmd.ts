import type { Command } from "commander";
import pc from "picocolors";
import { formatMs } from "../format.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

export function registerIndexCommand(program: Command, ctx: CliContext): void {
  program
    .command("index")
    .description("Build or incrementally update the repository index")
    .option("--force", "full re-index, ignoring all caches")
    .action(async (options: { force?: boolean }, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const stats = await app.index({ force: options.force === true });
      if (globals.json === true) {
        ctx.io.out(JSON.stringify(stats, null, 2));
        return;
      }
      ctx.io.out(
        [
          `${pc.green("indexed")} ${stats.files} files in ${formatMs(stats.durationMs)}` +
            (stats.incremental
              ? ` ${pc.dim(`(incremental: +${stats.addedFiles} ~${stats.changedFiles} -${stats.removedFiles})`)}`
              : ""),
          `  graph:      ${stats.nodes} nodes, ${stats.edges} edges (${stats.symbols} symbols)`,
          `  retrieval:  ${stats.chunks} chunks, ${stats.embeddedChunks} embedded`,
        ].join("\n"),
      );
      for (const warning of stats.warnings) {
        ctx.io.err(pc.yellow(`warning: ${warning}`));
      }
    });
}
