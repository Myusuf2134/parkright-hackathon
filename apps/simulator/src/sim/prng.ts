/**
 * Seeded randomness. Every random choice in the simulator comes from here, keyed by
 * (seed, purpose, …), so the same inputs always produce the same scene regardless
 * of call order, frame rate or what else happened earlier.
 *
 * No Math.random() anywhere in src/sim or src/scene (enforced by test/determinism.test.ts).
 */

/** 32-bit FNV-1a over the key parts. */
export function hashKey(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = `${part}\u001f`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for scene variation. */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  chance(p: number): boolean;
}

export function rng(seed: number, ...key: readonly (string | number)[]): Rng {
  const next = mulberry32(hashKey(seed, ...key));
  const r: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [item, w] of items) if ((x -= w) < 0) return item;
      return items[items.length - 1]![0];
    },
    chance: (p) => next() < p,
  };
  return r;
}
