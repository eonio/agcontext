import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Clock } from "../core/interfaces.js";
import { systemClock } from "../core/interfaces.js";

/**
 * Telemetry (phase 16). Disabled by default; when enabled, events stay local:
 * an in-memory ring buffer powers `agc stats`, and an optional JSONL sink
 * appends to `.agcontext/telemetry/events.jsonl`. AGContext never transmits
 * telemetry over the network.
 */

export type TelemetryFieldValue = number | string | boolean;

export interface TelemetryEvent {
  name: string;
  at: number;
  fields: Record<string, TelemetryFieldValue>;
}

export interface TelemetrySink {
  record(event: TelemetryEvent): void;
  flush?(): Promise<void>;
}

export class MemorySink implements TelemetrySink {
  private readonly buffer: TelemetryEvent[] = [];

  constructor(private readonly capacity = 1000) {}

  record(event: TelemetryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  events(): readonly TelemetryEvent[] {
    return this.buffer;
  }
}

export class JsonlFileSink implements TelemetrySink {
  private pending: string[] = [];

  constructor(private readonly filePath: string) {}

  record(event: TelemetryEvent): void {
    this.pending.push(JSON.stringify(event));
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const lines = `${this.pending.join("\n")}\n`;
    this.pending = [];
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, lines, "utf8");
  }
}

export interface TelemetrySummaryEntry {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export class Telemetry {
  readonly enabled: boolean;
  private readonly sinks: TelemetrySink[];
  private readonly memory: MemorySink;
  private readonly clock: Clock;

  constructor(options: { enabled: boolean; sinks?: TelemetrySink[]; clock?: Clock }) {
    this.enabled = options.enabled;
    this.memory = new MemorySink();
    this.sinks = [this.memory, ...(options.sinks ?? [])];
    this.clock = options.clock ?? systemClock;
  }

  /** A no-op instance for the default, telemetry-off configuration. */
  static disabled(): Telemetry {
    return new Telemetry({ enabled: false });
  }

  record(name: string, fields: Record<string, TelemetryFieldValue> = {}): void {
    if (!this.enabled) return;
    const event: TelemetryEvent = { name, at: this.clock.now(), fields };
    for (const sink of this.sinks) sink.record(event);
  }

  /** Convenience timer: `const end = t.time("x"); ...; end({extra: 1})`. */
  time(name: string): (fields?: Record<string, TelemetryFieldValue>) => void {
    const start = this.clock.now();
    return (fields = {}) => {
      this.record(name, { ...fields, durationMs: this.clock.now() - start });
    };
  }

  events(): readonly TelemetryEvent[] {
    return this.memory.events();
  }

  /** Aggregates recorded events by name (durations averaged when present). */
  summary(): Record<string, TelemetrySummaryEntry> {
    const out: Record<string, TelemetrySummaryEntry> = {};
    for (const event of this.memory.events()) {
      const entry = (out[event.name] ??= { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 });
      entry.count++;
      const duration = event.fields["durationMs"];
      if (typeof duration === "number") {
        entry.totalMs += duration;
        entry.maxMs = Math.max(entry.maxMs, duration);
      }
    }
    for (const entry of Object.values(out)) {
      entry.avgMs = entry.count > 0 ? entry.totalMs / entry.count : 0;
    }
    return out;
  }

  async flush(): Promise<void> {
    for (const sink of this.sinks) {
      if (sink.flush) await sink.flush();
    }
  }
}
