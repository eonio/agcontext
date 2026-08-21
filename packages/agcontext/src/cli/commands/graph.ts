import type { Command } from "commander";
import pc from "picocolors";
import type { ExplainRelation } from "../../core/types.js";
import { heading, table } from "../format.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

export function registerGraphCommand(program: Command, ctx: CliContext): void {
  program
    .command("graph")
    .argument("[target]", "node id, symbol name, or file path to inspect")
    .description("Show graph statistics, or a node's neighborhood")
    .action(async (target: string | undefined, _options: unknown, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);

      if (target === undefined) {
        const graph = await app.graph();
        const stats = graph.stats();
        if (globals.json === true) {
          ctx.io.out(JSON.stringify(stats, null, 2));
          return;
        }
        ctx.io.out(heading(`code graph — ${stats.nodes} nodes, ${stats.edges} edges`));
        ctx.io.out("");
        ctx.io.out(
          table(
            ["node kind", "count"],
            Object.entries(stats.nodesByKind)
              .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
              .map(([kind, count]) => [kind, String(count)]),
          ),
        );
        ctx.io.out("");
        ctx.io.out(
          table(
            ["edge kind", "count"],
            Object.entries(stats.edgesByKind)
              .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
              .map(([kind, count]) => [kind, String(count)]),
          ),
        );
        return;
      }

      const explanation = await app.explain(target);
      if (globals.json === true) {
        ctx.io.out(JSON.stringify(explanation, null, 2));
        return;
      }
      const location =
        explanation.file !== undefined
          ? `${explanation.file}${explanation.startLine !== undefined ? `:${explanation.startLine}-${explanation.endLine ?? explanation.startLine}` : ""}`
          : "";
      ctx.io.out(
        heading(`${explanation.kind} ${explanation.name}`) +
          (location ? ` ${pc.dim(location)}` : ""),
      );
      const grouped = new Map<string, ExplainRelation[]>();
      for (const relation of explanation.relations) {
        const key = `${relation.direction === "out" ? "" : "incoming "}${relation.kind}${relation.variant ? ` (${relation.variant})` : ""}`;
        const bucket = grouped.get(key);
        if (bucket) bucket.push(relation);
        else grouped.set(key, [relation]);
      }
      if (grouped.size === 0) {
        ctx.io.out(pc.dim("no non-structural relations recorded"));
        return;
      }
      for (const [label, relations] of grouped) {
        ctx.io.out("");
        ctx.io.out(pc.bold(label));
        for (const relation of relations) {
          ctx.io.out(`  ${relation.name}${relation.path ? pc.dim(`  ${relation.path}`) : ""}`);
        }
      }
    });
}
