/**
 * CLI IO seam: stdout carries data (parseable, pipeable), stderr carries
 * human commentary. Tests inject a capturing implementation.
 */
export interface CliIO {
  /** Writes a line to stdout (data channel). */
  out(text: string): void;
  /** Writes a line to stderr (status channel). */
  err(text: string): void;
}

export const processIO: CliIO = {
  out: (text) => {
    process.stdout.write(`${text}\n`);
  },
  err: (text) => {
    process.stderr.write(`${text}\n`);
  },
};

/** Command failure with a specific exit code; message already printed or printable. */
export class CliFailure extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliFailure";
    this.exitCode = exitCode;
  }
}
