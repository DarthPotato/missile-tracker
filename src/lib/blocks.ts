// Block-grid math: split a stockpile into equal blocks (10 missiles, or a
// fixed dollar amount) and say how many are left, uncertain, or used.
import type { Headline } from "./model";

export interface BlockCounts {
  /** Blocks in the prewar stockpile. */
  total: number;
  /** Blocks still there at the low end of the estimate. */
  left: number;
  /** Blocks that may or may not be there: the range up to the high end. */
  uncertain: number;
  /** The rest: used since the war began. */
  used: number;
}

/**
 * `perBlock` is in the same unit as `scale` × missiles: 10 with scale 1 means
 * "1 block = 10 missiles"; 50e6 with scale = unit cost means "1 block = $50M".
 * Partial blocks round so the total matches the prewar figure, and the left
 * and uncertain counts never exceed it.
 */
export function blockCounts(
  h: Pick<Headline, "prewar" | "remaining" | "qualifier">,
  perBlock: number,
  scale = 1,
): BlockCounts {
  const blocks = (missiles: number) => (missiles * scale) / perBlock;
  const total = Math.max(1, Math.round(blocks(h.prewar)));
  const clamp = (n: number) => Math.max(0, Math.min(total, n));
  // "At most N left" means the true number is somewhere below N: all uncertain.
  const lowMissiles = h.qualifier === "at-most" ? 0 : h.remaining.low;
  const left = clamp(Math.floor(blocks(lowMissiles)));
  const upTo = clamp(Math.round(blocks(h.remaining.high)));
  const uncertain = Math.max(0, upTo - left);
  return { total, left, uncertain, used: total - left - uncertain };
}

/** "$50M", "$1B" */
export function formatDollars(n: number): string {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
