// The live intercept log: drones and missiles reported shot down, pulled from
// public Telegram channels and news headlines several times a day.
//
// This is deliberately kept apart from the vetted data in data/reports/:
//  - it is published without a human review step, so it can stay current;
//  - most of it is unverified (Telegram posts, early news), and the site says so
//    on every figure;
//  - nothing here feeds the stockpile headlines or the rebuild model.
//
// What it does share with the vetted data: every figure carries the verbatim
// text it came from, and the pipeline throws out any figure whose quote isn't
// in the post word for word.
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Iran-related theaters first: they're what the stockpile figures are about. */
export const THEATERS = ["gulf", "israel", "red-sea", "ukraine", "other"] as const;
export const Theater = z.enum(THEATERS);
export type Theater = z.infer<typeof Theater>;

export const THEATER_LABEL: Record<Theater, string> = {
  gulf: "Persian Gulf",
  israel: "Israel",
  "red-sea": "Red Sea",
  ukraine: "Ukraine",
  other: "Elsewhere",
};

/** The theaters that draw on the same U.S. interceptor stocks the site tracks. */
export const IRAN_THEATERS: readonly Theater[] = ["gulf", "israel", "red-sea"];

export const Threat = z.enum(["drone", "cruise", "ballistic", "mixed", "unknown"]);
export type Threat = z.infer<typeof Threat>;

export const THREAT_LABEL: Record<Threat, string> = {
  drone: "drones",
  cruise: "cruise missiles",
  ballistic: "ballistic missiles",
  mixed: "drones and missiles",
  unknown: "aerial targets",
};

export const LiveSource = z
  .object({
    kind: z.enum(["telegram", "news"]),
    /** Channel or outlet name as shown to readers. */
    name: z.string().min(2),
    url: z.url(),
    /** When the post or story went up (ISO timestamp or date). */
    posted: z.string().min(10),
    /** The channel speaks for the force doing the intercepting (e.g. Ukraine's Air Force). */
    official: z.boolean(),
    launched: z.number().int().nonnegative().nullable(),
    intercepted: z.number().int().nonnegative().nullable(),
    /** Verbatim from the post or headline; checked by the pipeline. */
    quote: z.string().min(8),
  })
  .strict();
export type LiveSource = z.infer<typeof LiveSource>;

export const LiveEvent = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The day the attack happened (local), not when it was posted. */
    date: isoDate,
    theater: Theater,
    /** Who did the intercepting: "United States", "Bahrain", "Ukraine". */
    defender: z.string().min(2),
    threat: Threat,
    /** Interceptor systems the sources name ("Patriot", "SM-6"). */
    systems: z.array(z.string()),
    /** Sources say U.S. forces or U.S.-made interceptors were involved. */
    usInvolved: z.boolean(),
    sources: z.array(LiveSource).min(1),
  })
  .strict();
export type LiveEvent = z.infer<typeof LiveEvent>;

export const LiveFile = z
  .object({
    /** ISO timestamp of the last successful pipeline run, null before the first. */
    updated: z.string().nullable(),
    events: z.array(LiveEvent),
  })
  .strict();
export type LiveFile = z.infer<typeof LiveFile>;

/** Ties events reported by different channels together. */
export function eventKey(e: Pick<LiveEvent, "date" | "theater" | "defender" | "threat">): string {
  return [e.date, e.theater, e.defender.toLowerCase().replace(/[^a-z]+/g, "-"), e.threat].join("|");
}

/** Merge new events into the log: same day, theater, defender and threat = same event, more sources. */
export function mergeEvents(existing: LiveEvent[], incoming: LiveEvent[]): LiveEvent[] {
  const byKey = new Map(existing.map((e) => [eventKey(e), structuredClone(e)]));
  for (const e of incoming) {
    const k = eventKey(e);
    const cur = byKey.get(k);
    if (!cur) {
      byKey.set(k, structuredClone(e));
      continue;
    }
    for (const s of e.sources) if (!cur.sources.some((x) => x.url === s.url)) cur.sources.push(s);
    cur.systems = [...new Set([...cur.systems, ...e.systems])];
    cur.usInvolved ||= e.usInvolved;
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export interface CountRange {
  low: number;
  high: number;
}

/**
 * An event's count across its sources. Official channels win when they give a
 * number; otherwise the range of what the sources say.
 */
export function eventCount(e: LiveEvent, field: "launched" | "intercepted"): CountRange | undefined {
  const all = e.sources.filter((s) => s[field] !== null);
  const official = all.filter((s) => s.official);
  const use = official.length ? official : all;
  if (!use.length) return undefined;
  const vals = use.map((s) => s[field]!);
  return { low: Math.min(...vals), high: Math.max(...vals) };
}

export type Reliability = "official" | "corroborated" | "single";

/** How much to trust an event: an official channel, two or more independent sources, or one unverified source. */
export function reliability(e: LiveEvent): Reliability {
  if (e.sources.some((s) => s.official)) return "official";
  return new Set(e.sources.map((s) => s.name)).size > 1 ? "corroborated" : "single";
}

export const RELIABILITY_LABEL: Record<Reliability, string> = {
  official: "Official channel",
  corroborated: "Multiple sources",
  single: "Single source",
};

/** Totals over events, as low/high so disagreement between sources carries through. */
export function totals(events: LiveEvent[]): { intercepted: CountRange; launched: CountRange; events: number } {
  const sum = (field: "launched" | "intercepted") =>
    events.reduce(
      (acc, e) => {
        const c = eventCount(e, field);
        return c ? { low: acc.low + c.low, high: acc.high + c.high } : acc;
      },
      { low: 0, high: 0 },
    );
  return { intercepted: sum("intercepted"), launched: sum("launched"), events: events.length };
}

/** Events on or after `since` (YYYY-MM-DD) in the given theaters. */
export function filterEvents(events: LiveEvent[], since: string, theaters?: readonly Theater[]): LiveEvent[] {
  return events.filter((e) => e.date >= since && (!theaters || theaters.includes(e.theater)));
}

/** Intercepted per day, split by threat, for the last `days` days ending `today`. */
export function dailySeries(
  events: LiveEvent[],
  today: string,
  days: number,
): { date: string; byThreat: Partial<Record<Threat, number>>; total: number }[] {
  const out: { date: string; byThreat: Partial<Record<Threat, number>>; total: number }[] = [];
  const end = Date.parse(`${today}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    const byThreat: Partial<Record<Threat, number>> = {};
    let total = 0;
    for (const e of events) {
      if (e.date !== date) continue;
      const c = eventCount(e, "intercepted");
      if (!c) continue;
      // Plot the conservative end; the list shows the full range.
      byThreat[e.threat] = (byThreat[e.threat] ?? 0) + c.low;
      total += c.low;
    }
    out.push({ date, byThreat, total });
  }
  return out;
}

export function daysAgo(today: string, n: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}
