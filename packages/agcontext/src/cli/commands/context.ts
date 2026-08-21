import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { renderContext } from "../../context/render.js";
import type { ContextFormat, RetrievalStrategy } from "../../core/types.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

interface ContextCommandOptions {
  format?: ContextFormat;
  budget?: number;
  out?: string;
  strategy?: RetrievalStrategy;
  depth?: number;
  architecture: boolean;
  recommendations: boolean;
}

export function registerContextCommand(program: Command, ctx: CliContext): void {
  program
    .command("context")
    .argument("<query>", "question or task description")
    .description("Assemble a token-budgeted context package for an agent")
    .option("-f, --format <format>", "markdown | xml | json")
    .option("-b, --budget <tokens>", "token budget", (value) => Number.parseInt(value, 10))
    .option("-o, --out <file>", "write to a file instead of stdout")
    .option("-s, --strategy <strategy>", "hybrid | graph | lexical | semantic")
    .option("-d, --depth <hops>", "graph expansion depth", (value) => Number.parseInt(value, 10))
    .option("--no-architecture", "omit the architecture section")
    .option("--no-recommendations", "omit the recommendations section")
    .action(async (query: string, options: ContextCommandOptions, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const pkg = await app.context({
        query,
        ...(options.budget !== undefined ? { maxTokens: options.budget } : {}),
        ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
        ...(options.depth !== undefined ? { graphDepth: options.depth } : {}),
        includeArchitecture: options.architecture,
        includeRecommendations: options.recommendations,
      });
      const format: ContextFormat =
        options.format ??
        (globals.json === true ? "json" : (await app.resolvedConfig()).context.format);
      const text = renderContext(pkg, format);

      if (options.out !== undefined) {
        const target = path.resolve(options.out);
        await writeFile(target, text, "utf8");
        ctx.io.err(`${pc.green("wrote")} ${target}`);
      } else {
        ctx.io.out(text);
      }
      ctx.io.err(
        pc.dim(
          `context: ${pkg.files.length} files, ${pkg.symbols.length} symbols — ` +
            `${pkg.tokens.used}/${pkg.tokens.budget} tokens (${format})`,
        ),
      );
    });
}
