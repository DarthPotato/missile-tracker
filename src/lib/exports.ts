// Flat views of the dataset for the download endpoints (CSV/JSON) and the
// RSS feed. Pure functions so tests can check them without a build.
import type { Dataset } from "./dataset";
import { headline } from "./model";

export const CLAIM_COLUMNS = [
  "report_id",
  "outlet",
  "title",
  "url",
  "archive_url",
  "published",
  "source_kind",
  "added_by",
  "munition",
  "metric",
  "low",
  "high",
  "qualifier",
  "as_of",
  "confidence",
  "attribution",
  "quote",
] as const;

export type ClaimRow = Record<(typeof CLAIM_COLUMNS)[number], string | number | null>;

/** One row per sourced claim, newest source first. */
export function claimRows(ds: Dataset): ClaimRow[] {
  return [...ds.reports]
    .sort((a, b) => b.source.published.localeCompare(a.source.published) || a.id.localeCompare(b.id))
    .flatMap((r) =>
      r.claims.map((c) => ({
        report_id: r.id,
        outlet: r.source.outlet,
        title: r.source.title,
        url: r.source.url,
        archive_url: r.source.archiveUrl ?? null,
        published: r.source.published,
        source_kind: r.source.kind,
        added_by: r.addedBy,
        munition: c.munition,
        metric: c.metric,
        low: c.low ?? null,
        high: c.high ?? null,
        qualifier: c.qualifier ?? null,
        as_of: c.asOf,
        confidence: c.confidence,
        attribution: c.attribution ?? null,
        quote: c.quote,
      })),
    );
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, string | number | null>>(
  columns: readonly (keyof T)[],
  rows: T[],
): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** The site's current headline figure per missile, with the sources behind it. */
export function headlineRows(ds: Dataset) {
  return ds.munitions.map((m) => {
    const h = headline(ds.reports, m.id)!;
    return {
      munition: m.id,
      name: m.name,
      as_of: h.asOf,
      remaining_low: h.remaining.low,
      remaining_high: h.remaining.high,
      qualifier: h.qualifier,
      method: h.method,
      prewar: h.prewar,
      pct_left_low: Math.round(h.pctLeft.low * 10) / 10,
      pct_left_high: Math.round(h.pctLeft.high * 10) / 10,
      sources: [...new Set([...h.basis, h.prewarRef].map((b) => b.report.id))],
    };
  });
}

export function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** RSS 2.0: one item per source added to the log, newest first. */
export function rss(
  ds: Dataset,
  siteUrl: string,
  sitePath: (p: string) => string,
  title: string,
  description: string,
): string {
  const abs = (p: string) => new URL(sitePath(p), siteUrl).href;
  const items = [...ds.reports]
    .sort((a, b) => b.source.published.localeCompare(a.source.published) || a.id.localeCompare(b.id))
    .slice(0, 50)
    .map((r) => {
      const ids = [...new Set(r.claims.map((c) => c.munition).filter((m) => m !== "all"))];
      const names = ids.map((id) => ds.munitionById.get(id as never)?.name ?? id);
      const link = ids.length === 1 ? abs(`/missiles/${ids[0]}/`) : abs("/#updates");
      return `    <item>
      <title>${xmlEscape(`${r.source.outlet}: ${r.source.title}`)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="false">${xmlEscape(r.id)}</guid>
      <pubDate>${new Date(`${r.source.published}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${xmlEscape(`${r.summary}${names.length ? ` (${names.join(", ")})` : ""} Source: ${r.source.url}`)}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(abs("/"))}</link>
    <atom:link href="${xmlEscape(abs("/feed.xml"))}" rel="self" type="application/rss+xml" />
    <description>${xmlEscape(description)}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}
