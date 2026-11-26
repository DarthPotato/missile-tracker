// The quote check, as pure functions: which pages to fetch and which quotes
// each must contain, then a result object. The CLI (validate-data.ts) and the
// daily watcher both use it; tests drive it with a fake fetcher.
import type { Dataset } from "../src/lib/dataset.ts";
import { sourcedParams } from "../src/lib/dataset.ts";
import type { DronesFile, PerspectiveFile } from "../src/lib/schema.ts";
import { containsQuote } from "../src/lib/text.ts";
import { rawSnapshot } from "./archive.ts";

/** One source page and every quote this repo attributes to it. */
export interface QuoteTarget {
  /** A report id, or "perspective" for the perspective page's figures. */
  id: string;
  url: string;
  /** Wayback snapshot to read when the original can't be fetched. */
  archiveUrl?: string;
  quotes: string[];
  manual: boolean;
}

export interface QuoteResult {
  found: number;
  missing: { id: string; quote: string }[];
  unreachable: { id: string; url: string; error: string; strict: boolean }[];
  /** Sources checked against their archived copy because the original couldn't be fetched. */
  viaArchive: string[];
  manual: string[];
  ok: boolean;
}

export const PERSPECTIVE = "perspective";
export const DRONES = "drones";

export function quoteTargets(ds: Dataset, perspective?: PerspectiveFile, drones?: DronesFile): QuoteTarget[] {
  const targets: QuoteTarget[] = ds.reports.map((r) => ({
    id: r.id,
    url: r.source.url,
    archiveUrl: r.source.archiveUrl,
    manual: r.quoteCheck === "manual",
    quotes: [
      ...new Set([
        ...r.claims.map((c) => c.quote),
        ...ds.munitions.flatMap((m) =>
          sourcedParams(m)
            .filter((p) => p.reportId === r.id)
            .map((p) => p.quote),
        ),
      ]),
    ],
  }));
  if (perspective) {
    const figures = [
      ...perspective.amounts.flatMap((a) => (a.source ? [a.source] : [])),
      ...perspective.comparisons.map((c) => c.source),
      ...perspective.programs.map((g) => g.source),
    ];
    for (const f of figures)
      targets.push({
        id: PERSPECTIVE,
        url: f.url,
        archiveUrl: f.archiveUrl,
        quotes: [f.quote],
        manual: f.quoteCheck === "manual",
      });
  }
  if (drones) {
    const figures = [
      ...drones.warDamage.sources.map((source) => ({ source })),
      ...drones.jets.losses,
      ...drones.jets.tallies,
      ...drones.drones.flatMap((d) => [...(d.fleetBefore ? [d.fleetBefore] : []), ...d.fleetAfter, ...d.losses]),
    ];
    for (const { source: f } of figures)
      targets.push({
        id: DRONES,
        url: f.url,
        archiveUrl: f.archiveUrl,
        quotes: [f.quote],
        manual: f.quoteCheck === "manual",
      });
  }
  return targets;
}

/**
 * Which targets must be reachable, given the files a pull request changed:
 * a changed report, the reports a changed munitions.json points at, or the
 * perspective figures. Everything else may be unreachable without failing.
 */
export function strictIdsFromChanged(paths: string[], ds: Dataset): Set<string> {
  const ids = new Set<string>();
  for (const p of paths) {
    const file = p.split("/").pop() ?? "";
    if (p.includes("data/reports/") && file.endsWith(".json")) ids.add(file.slice(0, -5));
    if (file === "perspective.json") ids.add(PERSPECTIVE);
    if (file === "drones.json") ids.add(DRONES);
    if (file === "munitions.json") for (const m of ds.munitions) for (const s of sourcedParams(m)) ids.add(s.reportId);
  }
  return ids;
}

export interface CheckOptions {
  /** Targets whose page must be reachable. Default: all of them. */
  strict?: (id: string) => boolean;
  /** Escape hatch: pass even when no source could be fetched at all. */
  allowNoneReachable?: boolean;
}

/**
 * Fetch each page once, look for its quotes. Fails when a quote is missing,
 * when a strict source can't be fetched, or when no source at all could be
 * fetched (so a dead network never reads as a pass) unless explicitly allowed.
 */
export async function checkQuotes(
  targets: QuoteTarget[],
  fetchText: (url: string) => Promise<string>,
  opts: CheckOptions = {},
): Promise<QuoteResult> {
  const strict = opts.strict ?? (() => true);
  const result: QuoteResult = { found: 0, missing: [], unreachable: [], viaArchive: [], manual: [], ok: true };
  const pages = new Map<string, Promise<string>>();
  let attempted = 0;
  let reached = 0;

  for (const t of targets) {
    if (t.manual) {
      result.manual.push(t.id);
      continue;
    }
    attempted++;
    if (!pages.has(t.url)) pages.set(t.url, fetchText(t.url));
    let text: string;
    try {
      text = await pages.get(t.url)!;
    } catch (e) {
      // The original is down or refuses us: read the archived copy instead.
      const archived = t.archiveUrl ? rawSnapshot(t.archiveUrl) : undefined;
      if (archived && !pages.has(archived)) pages.set(archived, fetchText(archived));
      try {
        if (!archived) throw e;
        text = await pages.get(archived)!;
        result.viaArchive.push(t.id);
      } catch {
        result.unreachable.push({ id: t.id, url: t.url, error: (e as Error).message, strict: strict(t.id) });
        continue;
      }
    }
    reached++;
    for (const q of t.quotes) {
      if (containsQuote(text, q)) result.found++;
      else result.missing.push({ id: t.id, quote: q });
    }
  }

  result.ok =
    result.missing.length === 0 &&
    result.unreachable.every((u) => !u.strict) &&
    (attempted === 0 || reached > 0 || !!opts.allowNoneReachable);
  return result;
}

/** "quotes: 41 found, 0 missing, 3 sources unreachable, 1 manual" */
export function summarize(r: QuoteResult): string {
  const archived = r.viaArchive.length ? `, ${r.viaArchive.length} read from archived copies` : "";
  return `quotes: ${r.found} found, ${r.missing.length} missing, ${r.unreachable.length} sources unreachable${archived}, ${r.manual.length} manual`;
}

/** Markdown bullets for sources already on the site that no longer check out. */
export function healthLines(r: QuoteResult): string[] {
  return [
    ...r.missing.map((m) => `- **${m.id}**: quote no longer found on the page: "${m.quote.slice(0, 160)}"`),
    ...r.unreachable.map((u) => `- **${u.id}**: couldn't fetch [the page](${u.url}) (${u.error}). Often temporary.`),
  ];
}
