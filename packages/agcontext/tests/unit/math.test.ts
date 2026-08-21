import { describe, expect, it } from "vitest";
import { clamp01, halfLifeDecay, logMinMaxScaler, minMaxScaler } from "../../src/core/math.js";

describe("minMaxScaler", () => {
  it("maps min to 0 and max to 1", () => {
    const scale = minMaxScaler([2, 4, 10]);
    expect(scale(2)).toBe(0);
    expect(scale(10)).toBe(1);
    expect(scale(6)).toBeCloseTo(0.5);
  });

  it("returns 0.5 for degenerate distributions", () => {
    expect(minMaxScaler([3, 3, 3])(3)).toBe(0.5);
    expect(minMaxScaler([])(42)).toBe(0.5);
  });

  it("clamps out-of-range values", () => {
    const scale = minMaxScaler([0, 10]);
    expect(scale(-5)).toBe(0);
    expect(scale(20)).toBe(1);
  });
});

describe("logMinMaxScaler", () => {
  it("compresses skewed distributions while preserving order", () => {
    const scale = logMinMaxScaler([0, 1, 10, 1000]);
    expect(scale(0)).toBe(0);
    expect(scale(1000)).toBe(1);
    expect(scale(10)).toBeGreaterThan(scale(1));
    // log scaling: 10 sits far above linear position 0.01
    expect(scale(10)).toBeGreaterThan(0.3);
  });
});

describe("halfLifeDecay", () => {
  const day = 86_400_000;

  it("is 1 at age zero and 0.5 at one half-life", () => {
    expect(halfLifeDecay(0, 30 * day)).toBe(1);
    expect(halfLifeDecay(30 * day, 30 * day)).toBeCloseTo(0.5);
    expect(halfLifeDecay(60 * day, 30 * day)).toBeCloseTo(0.25);
  });

  it("handles degenerate half-life", () => {
    expect(halfLifeDecay(10, 0)).toBe(0);
  });
});

describe("clamp01", () => {
  it("clamps into [0, 1]", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(7)).toBe(1);
  });
});
