/**
 * Array-backed binary heap. The graph expansion engine uses it as a max-heap
 * keyed on propagated relevance, giving best-first traversal under a budget.
 */
export class BinaryHeap<T> {
  private readonly items: T[] = [];

  /** `compare(a, b) < 0` means `a` has higher priority (pops first). */
  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const top = this.items[0];
    if (top === undefined) return undefined;
    const last = this.items.pop() as T;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    let i = index;
    const item = this.items[i] as T;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentItem = this.items[parent] as T;
      if (this.compare(item, parentItem) >= 0) break;
      this.items[i] = parentItem;
      i = parent;
    }
    this.items[i] = item;
  }

  private bubbleDown(index: number): void {
    let i = index;
    const length = this.items.length;
    const item = this.items[i] as T;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let best = i;
      let bestItem = item;
      if (left < length) {
        const leftItem = this.items[left] as T;
        if (this.compare(leftItem, bestItem) < 0) {
          best = left;
          bestItem = leftItem;
        }
      }
      if (right < length) {
        const rightItem = this.items[right] as T;
        if (this.compare(rightItem, bestItem) < 0) {
          best = right;
          bestItem = rightItem;
        }
      }
      if (best === i) break;
      this.items[best] = item;
      this.items[i] = bestItem;
      // Restore invariant: item continues sinking from `best`.
      i = best;
    }
    this.items[i] = item;
  }
}
