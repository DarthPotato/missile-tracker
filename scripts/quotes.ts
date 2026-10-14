// The quote check, as pure functions: which pages to fetch and which quotes
// each must contain, then a result object. The CLI (validate-data.ts) and the
// daily watcher both use it; tests drive it with a fake fetcher.
import type { Dataset } from "../src/lib/dataset.ts";
import { sourcedParams } from "../src/lib/dataset.ts";
import type { PerspectiveFile } from "../src/lib/schema.ts";
import { containsQuote } from "../src/lib/text.ts";

/** One source page and every quote this repo attributes to it. */
export interface QuoteTarget {
  /** A report id, or "perspective" for the perspective page's figures. */
  id: string;
  url: string;
  quotes: string[];
  manual: boolean;
}

export interface QuoteResult {
  found: number;
  missing: { id: string; quote: string }[];
  unreachable: { id: string; url: string; error: string; strict: boolean }[];
  manual: string[];
  ok: boolean;
}

export const PERSPECTIVE = "perspective";

export function quoteTargets(ds: Dataset, perspective?: PerspectiveFile): QuoteTarget[] {
  const targets: QuoteTarget[] = ds.reports.map((r) => ({
    id: r.id,
    url: r.source.url,
    manual: r.quoteCheck === "manual",
    quotes: [
      ...new Set([
        ...r.claims.map((c) => c.quote),
        ...ds.munitions.flatMap((m) => sourcedParams(m).filter((p) => p.reportId === r.id).map((p) => p.quote)),
      ]),
    ],
  }));
  if (perspective) {
    const figures = [
      ...perspective.amounts.flatMap((a) => (a.source ? [a.source] : [])),
      ...perspective.comparisons.map((c) => c.source),
    ];
    for (const f of figures) targets.push({ id: PERSPECTIVE, url: f.url, quotes: [f.quote], manual: f.quoteCheck === "manual" });
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
  const result: QuoteResult = { found: 0, missing: [], unreachable: [], manual: [], ok: true };
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
      result.unreachable.push({ id: t.id, url: t.url, error: (e as Error).message, strict: strict(t.id) });
      continue;
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
  return `quotes: ${r.found} found, ${r.missing.length} missing, ${r.unreachable.length} sources unreachable, ${r.manual.length} manual`;
}
