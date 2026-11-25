import type { Dataset } from "./dataset";
import { SPECIFICITY, claimsFor } from "./model";
import type { PerspectiveFile } from "./schema";

export interface Amount {
  id: string;
  label: string;
  value: number;
  source?: PerspectiveFile["amounts"][number]["source"];
  note?: string;
}

/**
 * Value of the tracked missiles fired so far: each missile's newest "used"
 * estimate times its unit cost. A range counts at its midpoint; "at least"
 * counts at its floor, so the total never overstates.
 */
export function trackedMissilesFired(ds: Dataset): { value: number; asOf: string } {
  let value = 0;
  let asOf = "";
  for (const m of ds.munitions) {
    const c = claimsFor(ds.reports, m.id)
      .map((r) => r.claim)
      .filter((c) => c.metric === "expended")
      .sort((a, b) => b.asOf.localeCompare(a.asOf) || SPECIFICITY[b.qualifier!] - SPECIFICITY[a.qualifier!])[0];
    if (!c) continue;
    const used = c.qualifier === "at-least" ? c.low! : (c.low! + c.high!) / 2;
    value += used * m.unitCostM.value * 1e6;
    if (c.asOf > asOf) asOf = c.asOf;
  }
  return { value, asOf };
}

export function resolveAmounts(p: PerspectiveFile, ds: Dataset): Amount[] {
  return p.amounts.map((a) => ({
    id: a.id,
    label: a.label,
    value: a.value ?? trackedMissilesFired(ds).value,
    source: a.source,
    note: a.note,
  }));
}

/** "7.0 billion", "14.8 million", "448,000", "3,880" */
export function formatBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e4) return `${(Math.round(n / 1000) * 1000).toLocaleString("en-US")}`;
  return Math.round(n).toLocaleString("en-US");
}

/**
 * How long `amount` would run a program that costs `annualCost` a year,
 * in the largest unit that reads naturally: "2.5 years", "5.6 months",
 * "9 days", "2.3 hours", "14 minutes".
 */
export function formatDuration(amount: number, annualCost: number): string {
  const years = amount / annualCost;
  const unit = (n: number, word: string) => {
    const shown = n >= 10 ? Math.round(n).toString() : (+n.toFixed(1)).toString();
    return `${shown} ${word}${shown === "1" ? "" : "s"}`;
  };
  if (years >= 1) return unit(years, "year");
  const months = years * 12;
  if (months >= 1) return unit(months, "month");
  const days = years * 365;
  if (days >= 1) return unit(days, "day");
  const hours = days * 24;
  if (hours >= 1) return unit(hours, "hour");
  return unit(hours * 60, "minute");
}
