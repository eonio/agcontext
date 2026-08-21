import { Command, CommanderError } from "commander";
import pc from "picocolors";
import { AGContext } from "../agcontext.js";
import { AGContextError } from "../core/errors.js";
import type { LogLevel } from "../core/interfaces.js";
import { ConsoleLogger } from "../core/logger.js";
import { packageInfo } from "../version.js";
import { registerContextCommand } from "./commands/context.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerIndexCommand } from "./commands/index-cmd.js";
import { registerInitCommand } from "./commands/init.js";
import { registerRetrieveCommand } from "./commands/retrieve.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerStatsCommand } from "./commands/stats.js";
import { CliFailure, processIO, type CliIO } from "./io.js";

export interface GlobalCliOptions {
  cwd?: string;
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface CliContext {
  io: CliIO;
  /** App factory — tests inject an AGContext wired with fixtures. */
  createApp: (options: GlobalCliOptions) => AGContext;
}

export function defaultCreateApp(options: GlobalCliOptions): AGContext {
  const logLevel: LogLevel = options.quiet ? "error" : "info";
  return new AGContext({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.config !== undefined ? { configFile: options.config } : {}),
    logger: new ConsoleLogger(logLevel),
  });
}

/** Builds the `agc` command tree (phase 13). */
export function buildProgram(ctx: CliContext): Command {
  const { version } = packageInfo();
  const program = new Command();
  program
    .name("agc")
    .description(
      "AGContext — Augmented Context. A context engineering harness for AI coding agents:\n" +
        "code graphs + hybrid retrieval + compression + multi-signal ranking + context assembly.",
    )
    .version(version, "-v, --version", "print the version")
    .option("--cwd <dir>", "run as if started in <dir>")
    .option("--config <file>", "explicit config file path")
    .option("--json", "machine-readable JSON output")
    .option("--quiet", "suppress informational logging")
    .configureOutput({
      writeOut: (text) => ctx.io.out(text.replace(/\n$/, "")),
      writeErr: (text) => ctx.io.err(text.replace(/\n$/, "")),
    })
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ agc init                       scaffold agcontext.config.ts",
        "  $ agc index                      build or update the index",
        '  $ agc search "authentication"    fast lexical search',
        '  $ agc retrieve "authentication"  full hybrid retrieval with ranking',
        '  $ agc context "how does auth work" --format xml',
        "  $ agc explain AuthService        symbol card with graph relations",
        "  $ agc doctor                     environment and index health checks",
      ].join("\n"),
    );

  registerInitCommand(program, ctx);
  registerIndexCommand(program, ctx);
  registerGraphCommand(program, ctx);
  registerSearchCommand(program, ctx);
  registerRetrieveCommand(program, ctx);
  registerContextCommand(program, ctx);
  registerExplainCommand(program, ctx);
  registerDoctorCommand(program, ctx);
  registerStatsCommand(program, ctx);

  program
    .command("version")
    .description("print the version")
    .action(() => {
      ctx.io.out(version);
    });

  return program;
}

/**
 * CLI entry: parses argv, maps errors to exit codes.
 * Returns the process exit code instead of exiting (testable).
 */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliContext> = {},
): Promise<number> {
  const io = overrides.io ?? processIO;
  const program = buildProgram({
    io,
    createApp: overrides.createApp ?? defaultCreateApp,
  });
  program.exitOverride();
  try {
    await program.parseAsync([...argv]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // help/version display and usage errors carry their own exit codes.
      return error.exitCode;
    }
    if (error instanceof CliFailure) {
      if (error.message.length > 0) io.err(pc.red(error.message));
      return error.exitCode;
    }
    if (error instanceof AGContextError) {
      io.err(pc.red(`${error.code}: ${error.message}`));
      return 1;
    }
    io.err(pc.red(error instanceof Error ? (error.stack ?? error.message) : String(error)));
    return 1;
  }
}
