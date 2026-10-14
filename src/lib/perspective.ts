import type { Dataset } from "./dataset";
import { PHASE1_DAYS, phase1BurnPerDay } from "./model";
import type { PerspectiveFile } from "./schema";

export interface Amount {
  id: string;
  label: string;
  value: number;
  source?: PerspectiveFile["amounts"][number]["source"];
  note?: string;
}

/** Value of the tracked missiles fired by the ceasefire: CSIS midpoint used × unit cost. */
export function trackedMissilesFired(ds: Dataset): number {
  return ds.munitions.reduce((sum, m) => {
    const perDay = phase1BurnPerDay(ds.reports, m.id) ?? 0;
    return sum + perDay * PHASE1_DAYS * m.unitCostM.value * 1e6;
  }, 0);
}

export function resolveAmounts(p: PerspectiveFile, ds: Dataset): Amount[] {
  return p.amounts.map((a) => ({
    id: a.id,
    label: a.label,
    value: a.value ?? trackedMissilesFired(ds),
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
