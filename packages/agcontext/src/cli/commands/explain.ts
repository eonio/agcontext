import type { Command } from "commander";
import pc from "picocolors";
import { heading } from "../format.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

interface ExplainCommandOptions {
  ai?: boolean;
  full?: boolean;
}

export function registerExplainCommand(program: Command, ctx: CliContext): void {
  program
    .command("explain")
    .argument("<target>", "symbol name, file path, or node id (e.g. AuthService)")
    .description("Explain a symbol or file: signature, relations, metrics")
    .option("--ai", "add an LLM-generated explanation (requires a generation provider)")
    .option("--full", "include the compressed file summary")
    .action(async (target: string, options: ExplainCommandOptions, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const explanation = await app.explain(target, { ai: options.ai === true });
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
          (location ? ` ${pc.dim(location)}` : "") +
          (explanation.exported === true ? ` ${pc.green("exported")}` : ""),
      );
      if (explanation.signature) ctx.io.out(`  ${explanation.signature}`);
      if (explanation.doc) ctx.io.out(`  ${pc.italic(explanation.doc)}`);

      const metricParts: string[] = [];
      const metrics = explanation.metrics;
      if (metrics.centrality !== undefined) {
        metricParts.push(`centrality ${metrics.centrality.toFixed(2)}`);
      }
      if (metrics.importance !== undefined) {
        metricParts.push(`importance ${metrics.importance.toFixed(2)}`);
      }
      if (metrics.usage !== undefined) metricParts.push(`usage ${metrics.usage.toFixed(2)}`);
      if (metrics.commitCount !== undefined) {
        metricParts.push(`${metrics.commitCount} commits`);
      }
      if (metricParts.length > 0) ctx.io.out(pc.dim(`  ${metricParts.join(" · ")}`));

      if (explanation.relations.length > 0) {
        ctx.io.out("");
        ctx.io.out(pc.bold("relations"));
        for (const relation of explanation.relations) {
          const arrow = relation.direction === "out" ? "→" : "←";
          const variant = relation.variant ? ` (${relation.variant})` : "";
          ctx.io.out(
            `  ${arrow} ${relation.kind}${variant}: ${relation.name}${relation.path ? pc.dim(`  ${relation.path}`) : ""}`,
          );
        }
      }

      if (options.full === true && explanation.fileSummary !== undefined) {
        ctx.io.out("");
        ctx.io.out(pc.bold("file summary"));
        ctx.io.out(explanation.fileSummary);
      }

      if (explanation.aiExplanation !== undefined) {
        ctx.io.out("");
        ctx.io.out(pc.bold("ai explanation"));
        ctx.io.out(explanation.aiExplanation);
      }
    });
}
