import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Clock } from "../../src/core/interfaces.js";
import { JsonlFileSink, MemorySink, Telemetry } from "../../src/telemetry/telemetry.js";
import { makeTempDir, removeDir } from "../helpers/testkit.js";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => removeDir(dir)));
});

function fixedClock(start = 1000): { clock: Clock; advance: (ms: number) => void } {
  let now = start;
  return {
    clock: { now: () => now },
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("Telemetry", () => {
  it("is disabled by default and records nothing", () => {
    const telemetry = Telemetry.disabled();
    telemetry.record("retrieval.pipeline", { durationMs: 12 });
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.events()).toHaveLength(0);
    expect(telemetry.summary()).toEqual({});
  });

  it("records events and aggregates durations when enabled", () => {
    const { clock, advance } = fixedClock();
    const telemetry = new Telemetry({ enabled: true, clock });
    telemetry.record("index.run", { durationMs: 100 });
    telemetry.record("index.run", { durationMs: 300 });
    telemetry.record("plain.event", { note: "no duration" });
    advance(50);
    const summary = telemetry.summary();
    expect(summary["index.run"]).toEqual({ count: 2, totalMs: 400, avgMs: 200, maxMs: 300 });
    expect(summary["plain.event"]?.count).toBe(1);
  });

  it("times spans with the injected clock", () => {
    const { clock, advance } = fixedClock();
    const telemetry = new Telemetry({ enabled: true, clock });
    const end = telemetry.time("stage");
    advance(250);
    end({ items: 3 });
    const event = telemetry.events()[0];
    expect(event?.fields["durationMs"]).toBe(250);
    expect(event?.fields["items"]).toBe(3);
  });

  it("caps the memory ring buffer", () => {
    const sink = new MemorySink(3);
    for (let i = 0; i < 5; i++) sink.record({ name: `e${i}`, at: i, fields: {} });
    expect(sink.events().map((event) => event.name)).toEqual(["e2", "e3", "e4"]);
  });

  it("persists JSONL through the file sink on flush", async () => {
    const dir = await makeTempDir("telemetry");
    tempDirs.push(dir);
    const file = path.join(dir, "telemetry", "events.jsonl");
    const telemetry = new Telemetry({
      enabled: true,
      sinks: [new JsonlFileSink(file)],
      clock: fixedClock().clock,
    });
    telemetry.record("a", { n: 1 });
    telemetry.record("b", { n: 2 });
    await telemetry.flush();
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0] as string) as { name: string }).name).toBe("a");
  });
});
