import { randomBytes } from "node:crypto";

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Human-friendly, URL-safe unique payment reference, e.g. OJ-M2K8F1-7QX3ZB */
export function paymentReference(): string {
  const rand = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `OJ-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
