import { describe, expect, it } from "vitest";
import { BinaryHeap } from "../../src/core/heap.js";

describe("BinaryHeap", () => {
  it("pops in priority order", () => {
    const heap = new BinaryHeap<number>((a, b) => a - b);
    for (const value of [5, 1, 4, 2, 8, 0, 7]) heap.push(value);
    const popped: number[] = [];
    while (heap.size > 0) popped.push(heap.pop() as number);
    expect(popped).toEqual([0, 1, 2, 4, 5, 7, 8]);
  });

  it("supports max-heap comparators", () => {
    const heap = new BinaryHeap<{ score: number }>((a, b) => b.score - a.score);
    heap.push({ score: 0.2 });
    heap.push({ score: 0.9 });
    heap.push({ score: 0.5 });
    expect(heap.pop()?.score).toBe(0.9);
    expect(heap.peek()?.score).toBe(0.5);
  });

  it("interleaves push and pop correctly", () => {
    const heap = new BinaryHeap<number>((a, b) => a - b);
    heap.push(3);
    heap.push(1);
    expect(heap.pop()).toBe(1);
    heap.push(0);
    heap.push(2);
    expect(heap.pop()).toBe(0);
    expect(heap.pop()).toBe(2);
    expect(heap.pop()).toBe(3);
    expect(heap.pop()).toBeUndefined();
  });
});
