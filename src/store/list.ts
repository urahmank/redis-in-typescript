import { normalizeIndex, normalizeRange } from './rangeUtil.js';

class ListNode {
  value: string;
  prev: ListNode | null = null;
  next: ListNode | null = null;

  constructor(value: string) {
    this.value = value;
  }
}

/**
 * Backing structure for the Redis List type.
 *
 * Real Redis lists are implemented as "quicklists" (linked lists of small
 * arrays) specifically so that push/pop at either end is O(1) regardless of
 * list length. A plain JS array would make `LPUSH`/`LPOP` O(n) because
 * `unshift`/`shift` have to reindex every element — which defeats the point
 * of the exercise — so this is a genuine doubly linked list instead.
 */
export class RedisList {
  private head: ListNode | null = null;
  private tail: ListNode | null = null;
  private length = 0;

  get size(): number {
    return this.length;
  }

  pushLeft(...values: string[]): number {
    for (const value of values) {
      const node = new ListNode(value);
      if (this.head === null) {
        this.head = this.tail = node;
      } else {
        node.next = this.head;
        this.head.prev = node;
        this.head = node;
      }
      this.length++;
    }
    return this.length;
  }

  pushRight(...values: string[]): number {
    for (const value of values) {
      const node = new ListNode(value);
      if (this.tail === null) {
        this.head = this.tail = node;
      } else {
        node.prev = this.tail;
        this.tail.next = node;
        this.tail = node;
      }
      this.length++;
    }
    return this.length;
  }

  popLeft(): string | undefined {
    if (this.head === null) return undefined;
    const value = this.head.value;
    this.head = this.head.next;
    if (this.head) this.head.prev = null;
    else this.tail = null;
    this.length--;
    return value;
  }

  popRight(): string | undefined {
    if (this.tail === null) return undefined;
    const value = this.tail.value;
    this.tail = this.tail.prev;
    if (this.tail) this.tail.next = null;
    else this.head = null;
    this.length--;
    return value;
  }

  private nodeAt(index: number): ListNode | null {
    const i = normalizeIndex(index, this.length);
    if (i === null) return null;

    // Walk from whichever end is closer, same trick real quicklists use.
    if (i <= this.length / 2) {
      let node = this.head;
      for (let n = 0; n < i && node; n++) node = node.next;
      return node;
    }

    let node = this.tail;
    for (let n = this.length - 1; n > i && node; n--) node = node.prev;
    return node;
  }

  at(index: number): string | undefined {
    return this.nodeAt(index)?.value;
  }

  set(index: number, value: string): boolean {
    const node = this.nodeAt(index);
    if (!node) return false;
    node.value = value;
    return true;
  }

  toArray(): string[] {
    const out: string[] = [];
    for (let node = this.head; node; node = node.next) out.push(node.value);
    return out;
  }

  range(start: number, stop: number): string[] {
    const bounds = normalizeRange(start, stop, this.length);
    if (!bounds) return [];
    const [s, e] = bounds;

    const out: string[] = [];
    let node = this.nodeAt(s);
    for (let i = s; i <= e && node; i++, node = node.next) out.push(node.value);
    return out;
  }

  /** LTRIM semantics: keep only the [start, stop] range, dropping everything else. */
  trim(start: number, stop: number): void {
    const kept = this.range(start, stop);
    this.head = this.tail = null;
    this.length = 0;
    this.pushRight(...kept);
  }

  /**
   * LREM semantics: count > 0 removes the first `count` matches head-to-tail,
   * count < 0 removes the first `|count|` matches tail-to-head, count === 0
   * removes every match. Returns the number of elements removed.
   */
  remove(count: number, value: string): number {
    const limit = count === 0 ? Infinity : Math.abs(count);
    let removed = 0;

    if (count >= 0) {
      let node = this.head;
      while (node && removed < limit) {
        const next = node.next;
        if (node.value === value) {
          this.unlink(node);
          removed++;
        }
        node = next;
      }
    } else {
      let node = this.tail;
      while (node && removed < limit) {
        const prev = node.prev;
        if (node.value === value) {
          this.unlink(node);
          removed++;
        }
        node = prev;
      }
    }

    return removed;
  }

  private unlink(node: ListNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;

    this.length--;
  }
}
