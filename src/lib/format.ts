import type { Qualifier } from "./schema";
import type { Range } from "./model";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole missiles. Sources' own figures are shown as published, never re-rounded. */
export function roundEstimate(n: number): number {
  return Math.round(n);
}

export const fmt = (n: number) => nf.format(n);

/** "an MQ-9", "an F-15E", "a KC-135", "a fighter jet": the article as the name is read aloud. */
export function withArticle(name: string): string {
  // Letters whose names start with a vowel sound (eff, em, ess) take "an" when spelled out.
  const an = /^[AEFHILMNORSX](?=[-\d/A-Z])/.test(name) || /^[aeiou]/i.test(name);
  return `${an ? "an" : "a"} ${name}`;
}

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

/**
 * The first sentence of a DVIDS caption. Their captions are full of
 * abbreviations ("Sept.", "La.", "Delbert D. Black") but the first sentence
 * always carries the date, so cut at the first full stop after the year
 * ("…, 2019." or "…, 2016 at Fort Wainwright, Alaska."), skipping initials.
 */
export function captionLead(caption: string): string {
  const lead = caption.match(/^.*?\b(?:19|20)\d{2}\b.*?(?<=\d|[^\sA-Z.]{2})\.(?=\s|$)/)?.[0] ?? caption;
  return lead.length > 320 ? `${lead.slice(0, 317).trimEnd()}…` : lead;
}

/** Days between the date a number describes and `today`. */
export function ageDays(asOf: string, today: string): number {
  return Math.max(0, daysBetween(asOf, today));
}

/** Past this, a headline is flagged as stale. */
export const STALE_DAYS = 60;

/** "121 days old" */
export function formatAge(days: number): string {
  return days === 0 ? "today" : days === 1 ? "1 day old" : `${fmt(days)} days old`;
}
