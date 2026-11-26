// The spread of estimates: every stock-left figure any source gives for one
// missile, on one axis, so readers see where sources agree and where they
// don't, instead of only the single headline number.
//
// Three kinds of point:
//   direct     - the source states a count left ("759-827 left")
//   derived    - the same document gives prewar and used; left = prewar - used
//   converted  - the source gives a share used ("about 50% used") of a total it
//                doesn't state; we apply the nearest prewar baseline and say so
//
// Converted points never feed the headline (model.ts keeps them out); they
// only appear here, drawn differently and labelled with the baseline used.
import type { Confidence, Qualifier } from "./schema";
import {
  claimsFor,
  deliveredSinceWar,
  invert,
  mid,
  prewarBaseline,
  stockPoints,
  type Headline,
  type Range,
} from "./model";
import type { Report, MunitionId } from "./schema";

export interface SpreadPoint {
  asOf: string;
  remaining: Range;
  qualifier: Qualifier;
  kind: "direct" | "derived" | "converted";
  confidence: Confidence;
  outlet: string;
  /** Who the source credits, when it isn't the outlet ("CSIS (Cancian & Park)"). */
  attribution?: string;
  url: string;
  published: string;
  /** For converted points: the prewar total applied, and where it came from. */
  baseline?: { value: number; outlet: string; published: string };
  /** True for the point the headline uses. */
  headline: boolean;
}

export function spreadPoints(reports: Report[], id: MunitionId, h?: Headline, deliveriesPerYear = 0): SpreadPoint[] {
  const refs = claimsFor(reports, id);
  const headBasis = h?.basis.at(-1)?.claim;

  const counted: SpreadPoint[] = stockPoints(refs, deliveriesPerYear).map((p) => {
    const last = p.basis.at(-1)!;
    return {
      asOf: p.asOf,
      remaining: p.remaining,
      qualifier: p.qualifier,
      kind: p.method === "direct" ? "direct" : "derived",
      confidence: last.claim.confidence,
      outlet: last.report.source.outlet,
      attribution: last.claim.attribution,
      url: last.report.source.url,
      published: last.report.source.published,
      headline: last.claim === headBasis,
    };
  });

  const converted: SpreadPoint[] = refs.flatMap((ref) => {
    if (ref.claim.metric !== "pct_expended") return [];
    const base = prewarBaseline(ref, refs);
    if (!base) return [];
    const prewar = mid({ low: base.claim.low!, high: base.claim.high! });
    const delivered = deliveredSinceWar(ref.claim.asOf, deliveriesPerYear);
    const left = (pct: number) => Math.max(0, prewar * (1 - pct / 100)) + delivered;
    return [
      {
        asOf: ref.claim.asOf,
        // More used means fewer left, so the ends swap.
        remaining: { low: left(ref.claim.high!), high: left(ref.claim.low!) },
        qualifier: invert(ref.claim.qualifier!),
        kind: "converted" as const,
        confidence: ref.claim.confidence,
        outlet: ref.report.source.outlet,
        attribution: ref.claim.attribution,
        url: ref.report.source.url,
        published: ref.report.source.published,
        baseline: { value: prewar, outlet: base.report.source.outlet, published: base.report.source.published },
        headline: false,
      },
    ];
  });

  return [...counted, ...converted].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.outlet.localeCompare(b.outlet));
}

/**
 * The lowest and highest figure among the most recent estimates: every point
 * dated within `windowDays` of the newest one. One-sided figures ("at most
 * 1,000") are left out when two-sided ones exist.
 */
export function recentSpread(
  points: SpreadPoint[],
  windowDays = 45,
): { low: number; high: number; n: number; since: string } | undefined {
  if (!points.length) return undefined;
  const newest = points.reduce((a, p) => (p.asOf > a ? p.asOf : a), points[0].asOf);
  const cutoff = new Date(Date.parse(newest) - windowDays * 86_400_000).toISOString().slice(0, 10);
  const inWindow = points.filter((p) => p.asOf >= cutoff);
  // One-sided figures ("at most 1,000") are bounds, not estimates; use them only when nothing else is recent.
  const twoSided = inWindow.filter((p) => p.qualifier !== "at-most" && p.qualifier !== "at-least");
  const recent = twoSided.length ? twoSided : inWindow;
  return {
    low: Math.min(...recent.map((p) => p.remaining.low)),
    high: Math.max(...recent.map((p) => p.remaining.high)),
    n: new Set(recent.map((p) => `${p.outlet}|${p.published}`)).size,
    since: recent.reduce((a, p) => (p.asOf < a ? p.asOf : a), newest),
  };
}
