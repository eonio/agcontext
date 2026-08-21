import type { Command } from "commander";
import { statusBadge } from "../format.js";
import { CliFailure } from "../io.js";
import type { CliContext, GlobalCliOptions } from "../program.js";

export function registerDoctorCommand(program: Command, ctx: CliContext): void {
  program
    .command("doctor")
    .description("Check environment, configuration, index freshness, and providers")
    .option("--network", "probe provider connectivity (makes one tiny API call)")
    .action(async (options: { network?: boolean }, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalCliOptions;
      const app = ctx.createApp(globals);
      const checks = await app.doctor({ network: options.network === true });
      if (globals.json === true) {
        ctx.io.out(JSON.stringify(checks, null, 2));
      } else {
        const width = Math.max(...checks.map((check) => check.name.length));
        for (const check of checks) {
          ctx.io.out(`${statusBadge(check.status)}  ${check.name.padEnd(width)}  ${check.detail}`);
        }
      }
      if (checks.some((check) => check.status === "fail")) {
        throw new CliFailure("", 1);
      }
    });
}
