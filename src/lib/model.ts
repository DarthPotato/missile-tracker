// The numbers behind the site: which estimate is the headline, what it implies
// about stock left, and a simple delivery/consumption projection.
//
// Pure functions with type-only imports, so the projection can ship to the
// browser for the interactive chart without pulling in zod.
import type { Claim, Munition, MunitionId, Qualifier, Report } from "./schema";

export const WAR_START = "2026-02-28";
/** Ceasefire took effect April 8 after 39 days of air and missile campaign. */
export const CEASEFIRE = "2026-04-08";
export const PHASE1_DAYS = 39;

export interface Range {
  low: number;
  high: number;
}

export interface ClaimRef {
  report: Report;
  claim: Claim;
}

/** A stock-left figure, tied to the claims it came from. */
export interface StockPoint {
  asOf: string;
  remaining: Range;
  qualifier: Qualifier;
  method: "direct" | "prewar-minus-expended";
  basis: ClaimRef[];
}

export interface Headline extends StockPoint {
  prewar: number;
  prewarRef: ClaimRef;
  pctLeft: Range;
  /** Newer claims that couldn't feed the headline (different baseline, or no numbers). */
  newer: ClaimRef[];
}

const SPECIFICITY: Record<Qualifier, number> = { range: 3, exact: 3, about: 2, "at-most": 1, "at-least": 1 };

/** Flip a qualifier when a number is subtracted from a fixed total. */
function invert(q: Qualifier): Qualifier {
  return q === "at-least" ? "at-most" : q === "at-most" ? "at-least" : q;
}

export function claimsFor(reports: Report[], id: MunitionId): ClaimRef[] {
  return reports.flatMap((report) => report.claims.filter((c) => c.munition === id).map((claim) => ({ report, claim })));
}

const mid = (r: Range) => (r.low + r.high) / 2;

/**
 * Every stock-left figure we can state without mixing sources: direct
 * "remaining" claims, plus prewar-minus-expended where one document gives both.
 */
export function stockPoints(refs: ClaimRef[]): StockPoint[] {
  const points: StockPoint[] = [];
  for (const ref of refs) {
    const { claim, report } = ref;
    if (claim.metric === "remaining") {
      points.push({
        asOf: claim.asOf,
        remaining: { low: claim.low!, high: claim.high! },
        qualifier: claim.qualifier!,
        method: "direct",
        basis: [ref],
      });
    } else if (claim.metric === "expended") {
      const prewar = report.claims.find((c) => c.munition === claim.munition && c.metric === "prewar");
      if (!prewar) continue;
      const p = mid({ low: prewar.low!, high: prewar.high! });
      points.push({
        asOf: claim.asOf,
        remaining: { low: Math.max(0, p - claim.high!), high: Math.max(0, p - claim.low!) },
        qualifier: invert(claim.qualifier!),
        method: "prewar-minus-expended",
        basis: [{ report, claim: prewar }, ref],
      });
    }
  }
  return points.sort((a, b) => a.asOf.localeCompare(b.asOf));
}

function rankPoint(a: StockPoint, b: StockPoint): number {
  return (
    b.asOf.localeCompare(a.asOf) ||
    SPECIFICITY[b.qualifier] - SPECIFICITY[a.qualifier] ||
    b.basis.at(-1)!.report.source.published.localeCompare(a.basis.at(-1)!.report.source.published)
  );
}

/** The prewar baseline that goes with a stock point: same document if it has one, else the latest earlier one. */
function prewarFor(point: StockPoint, refs: ClaimRef[]): ClaimRef | undefined {
  const source = point.basis.at(-1)!.report;
  const same = refs.find((r) => r.report === source && r.claim.metric === "prewar");
  if (same) return same;
  return refs
    .filter((r) => r.claim.metric === "prewar" && r.report.source.published <= source.source.published)
    .sort((a, b) => b.report.source.published.localeCompare(a.report.source.published))[0];
}

/**
 * The headline: the most recent stock figure, preferring tighter numbers on
 * ties. Claims we can't turn into a count (CNN's percentages on an unstated
 * baseline, "virtually all") are surfaced as `newer` rather than mixed in.
 */
export function headline(reports: Report[], id: MunitionId): Headline | undefined {
  const refs = claimsFor(reports, id);
  const best = stockPoints(refs).sort(rankPoint)[0];
  if (!best) return undefined;
  const prewarRef = prewarFor(best, refs);
  if (!prewarRef) return undefined;
  const prewar = mid({ low: prewarRef.claim.low!, high: prewarRef.claim.high! });
  const newer = refs
    .filter((r) => r.claim.asOf > best.asOf && r.claim.metric !== "prewar")
    .sort((a, b) => b.claim.asOf.localeCompare(a.claim.asOf));
  return {
    ...best,
    prewar,
    prewarRef,
    pctLeft: { low: (best.remaining.low / prewar) * 100, high: (best.remaining.high / prewar) * 100 },
    newer,
  };
}

/** Average daily use over the 39-day opening campaign, from the ceasefire tally. */
export function phase1BurnPerDay(reports: Report[], id: MunitionId): number | undefined {
  const atCeasefire = claimsFor(reports, id)
    .filter((r) => r.claim.metric === "expended" && r.claim.asOf === CEASEFIRE)
    .sort((a, b) => SPECIFICITY[b.claim.qualifier!] - SPECIFICITY[a.claim.qualifier!]);
  const c = atCeasefire[0]?.claim;
  return c ? mid({ low: c.low!, high: c.high! }) / PHASE1_DAYS : undefined;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface ProjectionInput {
  start: { date: string; low: number; high: number };
  prewar: number;
  /** Deliveries per year from orders already in the pipeline. */
  deliveriesPerYear: number;
  /** The FY2027 rebuild buy: `quantity` missiles at `perYear` from `begin` (YYYY-MM). */
  rebuild?: { quantity: number; begin: string; perYear: number };
  /** A renewed high-intensity campaign. */
  war?: { start: string; days: number; perDay: number };
  end: string;
}

export interface ProjectionPoint {
  date: string;
  low: number;
  high: number;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  /** First day each track gets back to the prewar level. */
  recovered: { low?: string; high?: string };
  /** First day each track hits zero during the scenario war. */
  depleted: { low?: string; high?: string };
  /** Missiles the scenario wanted to fire but couldn't (low track). */
  shortfall: number;
}

const DAY = 86_400_000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`) / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

/** Default delivery rate for the rebuild buy: a full lot in `lotMonths`, capped by announced capacity. */
export function defaultRebuildPerYear(m: Munition): number | undefined {
  if (!m.fy27Request) return undefined;
  const lotRate = (m.fy27Request.value * 12) / m.lotMonths.value;
  return Math.round(Math.min(lotRate, m.announcedCapacityPerYear?.value ?? Infinity));
}

/**
 * Day-by-day stock for the low and high ends of the starting estimate.
 * Deliveries arrive smoothly; scenario firing can't go below zero (the unmet
 * part is counted as shortfall). Output is sampled on the 1st of each month.
 */
export function project(input: ProjectionInput): ProjectionResult {
  const d0 = toDay(input.start.date);
  const dEnd = toDay(input.end);
  const baseDaily = input.deliveriesPerYear / 365.25;
  const rb = input.rebuild && input.rebuild.quantity > 0 && input.rebuild.perYear > 0 ? input.rebuild : undefined;
  const rbStart = rb ? toDay(rb.begin) : Infinity;
  const rbDaily = rb ? rb.perYear / 365.25 : 0;
  const war = input.war && input.war.days > 0 && input.war.perDay > 0 ? input.war : undefined;
  const warStart = war ? toDay(war.start) : Infinity;
  const warEnd = war ? warStart + war.days : -Infinity;

  let low = input.start.low;
  let high = input.start.high;
  let rbLeft = rb?.quantity ?? 0;
  let shortfall = 0;
  const recovered: ProjectionResult["recovered"] = {};
  const depleted: ProjectionResult["depleted"] = {};
  const points: ProjectionPoint[] = [{ date: input.start.date, low, high }];

  for (let d = d0 + 1; d <= dEnd; d++) {
    let delivered = baseDaily;
    if (d >= rbStart && rbLeft > 0) {
      const add = Math.min(rbDaily, rbLeft);
      rbLeft -= add;
      delivered += add;
    }
    low += delivered;
    high += delivered;

    if (d >= warStart && d < warEnd) {
      const want = war!.perDay;
      shortfall += Math.max(0, want - low);
      low = Math.max(0, low - want);
      high = Math.max(0, high - want);
      if (low === 0 && !depleted.low) depleted.low = fromDay(d);
      if (high === 0 && !depleted.high) depleted.high = fromDay(d);
    }

    const date = fromDay(d);
    // Recovery only counts once any scenario war is over.
    if (d >= warEnd || !war) {
      if (!recovered.low && low >= input.prewar) recovered.low = date;
      if (!recovered.high && high >= input.prewar) recovered.high = date;
    }
    const isMonthStart = date.endsWith("-01");
    const isWarEdge = war && (d === warStart || d === warEnd);
    if (isMonthStart || isWarEdge || d === dEnd) points.push({ date, low, high });
  }

  return { points, recovered, depleted, shortfall: Math.round(shortfall) };
}

/** Days the current stock would last at a given daily rate, with no new deliveries. */
export function daysOfFire(remaining: Range, perDay: number): Range | undefined {
  if (!(perDay > 0)) return undefined;
  return { low: remaining.low / perDay, high: remaining.high / perDay };
}
