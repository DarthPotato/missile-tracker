// U.S. drone losses: the Reaper page.
//
// Two kinds of data, kept apart on purpose:
//  - data/drones.json: fleet sizes and loss counts from U.S. officials and the
//    press, quote-checked like the stockpile data;
//  - data/live/drone-claims.json: Iranian and Houthi claims of drones shot
//    down, logged by the live feed without review. One-sided by nature; the
//    page says so on every figure and never mixes them into the U.S. count.
import { z } from "zod";
import type { Drone, DroneFigure, DroneId, DronesFile } from "./schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const ClaimSource = z
  .object({
    kind: z.enum(["telegram", "news"]),
    name: z.string().min(2),
    url: z.url(),
    posted: z.string().min(10),
    /** Verbatim from the post or headline; checked by the pipeline. */
    quote: z.string().min(8),
  })
  .strict();
export type ClaimSource = z.infer<typeof ClaimSource>;

export const DroneClaim = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The day it was shot down, as claimed. */
    date: isoDate,
    /** mq9 or mq1 for drones; jet for any manned U.S. combat jet, named in `model`. */
    aircraft: z.enum(["mq9", "mq1", "jet"]),
    /** For a jet, the type as claimed: "F-35", "F-15E". */
    model: z.string().optional(),
    /** Who says they shot it down: "IRGC", "Houthis", "Iranian Army". */
    claimant: z.string().min(2),
    /** Where, as claimed: "Strait of Hormuz", "Marib, Yemen". Empty when not given. */
    place: z.string(),
    count: z.number().int().positive(),
    /** The claimant's running total when they give one ("our 57th MQ-9"). */
    tally: z.number().int().positive().nullable(),
    /** A source says footage or photos of the downing or wreckage were released. */
    video: z.boolean(),
    /** U.S. officials have confirmed this loss. */
    usConfirmed: z.boolean(),
    sources: z.array(ClaimSource).min(1),
  })
  .strict();
export type DroneClaim = z.infer<typeof DroneClaim>;

export const DroneClaimsFile = z
  .object({
    updated: z.string().nullable(),
    claims: z.array(DroneClaim),
  })
  .strict();
export type DroneClaimsFile = z.infer<typeof DroneClaimsFile>;

/** Ties reports of the same claimed shoot-down together. */
export function claimKey(c: Pick<DroneClaim, "date" | "aircraft" | "tally" | "model">): string {
  if (c.aircraft === "jet") return `jet|${c.date}|${jetModel(c.model)}`;
  return c.tally !== null ? `${c.aircraft}|tally|${c.tally}` : `${c.aircraft}|${c.date}`;
}

/** "F-35A Lightning II", "f35", "F 35" -> "f-35": enough to tell one claimed jet type from another. */
export function jetModel(model: string | undefined): string {
  const m = (model ?? "").toLowerCase().match(/\b(f\/a|[fab])[\s-]?(\d{1,2})/);
  return m ? `${m[1]}-${m[2]}` : "jet";
}

/** Merge new claims into the log: same aircraft and running total, or same aircraft and day, is one claim. */
export function mergeClaims(existing: DroneClaim[], incoming: DroneClaim[]): DroneClaim[] {
  const out = existing.map((c) => structuredClone(c));
  for (const c of incoming) {
    // A report with a running total and one without, on the same day, are the same claim.
    const cur =
      out.find((x) => claimKey(x) === claimKey(c)) ??
      (c.aircraft === "jet"
        ? undefined
        : out.find((x) => x.aircraft === c.aircraft && x.date === c.date && (x.tally === null || c.tally === null)));
    if (!cur) {
      out.push(structuredClone(c));
      continue;
    }
    for (const s of c.sources) if (!cur.sources.some((x) => x.url === s.url)) cur.sources.push(s);
    cur.tally ??= c.tally;
    cur.count = Math.max(cur.count, c.count);
    cur.video ||= c.video;
    cur.usConfirmed ||= c.usConfirmed;
    if (!cur.place && c.place) cur.place = c.place;
    if (!cur.model && c.model) cur.model = c.model;
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export interface Tally {
  value: number;
  asOf: string;
}

/**
 * The claimed running total: start from the sourced baseline, then walk the
 * log forward. A claim that states its running total resets the count to it
 * (never down); one that doesn't adds its count.
 */
export function claimedTotal(
  base: DroneFigure | undefined,
  claims: DroneClaim[],
  aircraft: DroneId,
): Tally | undefined {
  let total = base?.value ?? 0;
  let asOf = base?.asOf ?? "";
  const after = claims
    .filter((c) => c.aircraft === aircraft && (!base || c.date > base.asOf))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const c of after) {
    total = c.tally !== null ? Math.max(total, c.tally) : total + c.count;
    asOf = c.date;
  }
  return base || after.length ? { value: total, asOf } : undefined;
}

/** Loss figures from one side, oldest first. */
export function lossesBy(d: Drone, side: "us" | "adversary"): (DroneFigure & { kind: string })[] {
  return d.losses
    .filter((l) => (side === "adversary" ? l.kind === "adversary" : l.kind !== "adversary"))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/**
 * What U.S. officials and the press have acknowledged, as a running total: a
 * figure that `adds` comes on top of the earlier total, any other replaces it
 * when higher.
 */
export function acknowledged(d: Drone): (Tally & { qualifier: DroneFigure["qualifier"] }) | undefined {
  let out: (Tally & { qualifier: DroneFigure["qualifier"] }) | undefined;
  for (const l of lossesBy(d, "us")) {
    if (!out) out = { value: l.value, asOf: l.asOf, qualifier: l.qualifier };
    else if (l.adds) out = { value: out.value + l.value, asOf: l.asOf, qualifier: "at-least" };
    else if (l.value >= out.value) out = { value: l.value, asOf: l.asOf, qualifier: l.qualifier };
  }
  return out;
}

export interface FleetEstimate {
  /** Fleet before the war less what the U.S. side acknowledges losing. */
  acknowledged?: { value: number; qualifier: "at-most" | "about"; asOf: string };
  /** The same fleet less every claimed shoot-down. */
  ifClaimsTrue?: { value: number; asOf: string };
}

/** Fleet left two ways: by what the U.S. acknowledges, and if every claim were true. */
export function fleetEstimate(d: Drone, claims: DroneClaim[]): FleetEstimate {
  if (!d.fleetBefore) return {};
  const start = d.fleetBefore.value;
  const ack = acknowledged(d);
  const claimed = claimedTotal(lossesBy(d, "adversary").at(-1), claims, d.id);
  return {
    acknowledged: ack
      ? {
          value: Math.max(0, start - ack.value),
          qualifier: ack.qualifier === "at-least" ? "at-most" : "about",
          asOf: ack.asOf,
        }
      : undefined,
    ifClaimsTrue: claimed ? { value: Math.max(0, start - claimed.value), asOf: claimed.asOf } : undefined,
  };
}

export interface SeriesPoint {
  date: string;
  value: number;
  label: string;
}

/**
 * Losses over time, two lines: what the U.S. side acknowledges (including the
 * drop between official fleet counts) and the claimed running total.
 */
export function lossSeries(d: Drone, claims: DroneClaim[]): { us: SeriesPoint[]; claimed: SeriesPoint[] } {
  const us: SeriesPoint[] = [];
  if (d.fleetBefore)
    for (const f of d.fleetAfter)
      us.push({
        date: f.asOf,
        value: d.fleetBefore.value - f.value,
        label: `Fleet down from ${d.fleetBefore.value} to ${f.value}`,
      });
  let running = 0;
  for (const l of lossesBy(d, "us")) {
    running = l.adds ? running + l.value : Math.max(running, l.value);
    us.push({ date: l.asOf, value: running, label: l.by });
  }
  us.sort((a, b) => a.date.localeCompare(b.date));

  const claimed: SeriesPoint[] = [];
  const base = lossesBy(d, "adversary").at(-1);
  if (base) claimed.push({ date: base.asOf, value: base.value, label: base.by });
  let total = base?.value ?? 0;
  for (const c of claims
    .filter((c) => c.aircraft === d.id && (!base || c.date > base.asOf))
    .sort((a, b) => a.date.localeCompare(b.date))) {
    total = c.tally !== null ? Math.max(total, c.tally) : total + c.count;
    claimed.push({ date: c.date, value: total, label: c.claimant });
  }
  return { us, claimed };
}

export const DRONE_SHORT: Record<DroneClaim["aircraft"], string> = { mq9: "MQ-9", mq1: "MQ-1", jet: "jet" };

export interface JetSummary {
  /** Shot down by enemy fire, as U.S. officials acknowledge. */
  shotDown: number;
  /** Downed by an ally's air defenses. */
  friendlyFire: number;
  /** Jets Iran or the Houthis claim, from the live log. */
  claimed: number;
  /** The newest logged claim, if any. */
  claimedTo?: string;
}

/** The jet tiles: confirmed shoot-downs, friendly fire, and claims, never added together. */
export function jetSummary(jets: DronesFile["jets"], claims: DroneClaim[]): JetSummary {
  const sum = (cause: string) => jets.losses.filter((l) => l.cause === cause).reduce((n, l) => n + l.count, 0);
  const log = claims.filter((c) => c.aircraft === "jet");
  return {
    shotDown: sum("shot-down"),
    friendlyFire: sum("friendly-fire"),
    claimed: log.reduce((n, c) => n + c.count, 0),
    claimedTo: log
      .map((c) => c.date)
      .sort()
      .at(-1),
  };
}
