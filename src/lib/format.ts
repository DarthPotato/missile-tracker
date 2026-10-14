import type { Qualifier } from "./schema";
import type { Range } from "./model";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole missiles. Sources' own figures are shown as published, never re-rounded. */
export function roundEstimate(n: number): number {
  return Math.round(n);
}

export const fmt = (n: number) => nf.format(n);

/** "759–827", "≤2,100", "~3,300", "≥40" */
export function formatRange(r: Range, q: Qualifier, unit = ""): string {
  const lo = fmt(roundEstimate(r.low)) + unit;
  const hi = fmt(roundEstimate(r.high)) + unit;
  if (q === "at-most") return `≤${hi}`;
  if (q === "at-least") return `≥${lo}`;
  if (q === "about") return `~${lo}`;
  return lo === hi ? lo : `${lo}–${hi}`;
}

/** Percent range, rounded to whole numbers: "33–35%", "~68%", "≤68%". */
export function formatPct(r: Range, q: Qualifier): string {
  const lo = Math.round(r.low);
  const hi = Math.round(r.high);
  if (q === "at-most") return `≤${hi}%`;
  if (q === "at-least") return `≥${lo}%`;
  if (q === "about" || lo === hi) return `~${lo}%`;
  return `${lo}–${hi}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 27, 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Mar 2030" */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
