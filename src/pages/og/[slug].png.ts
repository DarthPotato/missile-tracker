import type { APIRoute, GetStaticPaths } from "astro";
import { getDataset, getPerspective } from "../../lib/data";
import { headline } from "../../lib/model";
import { fmt, formatDate, formatPct, formatRange } from "../../lib/format";
import { stockStatus } from "../../lib/status";
import { formatBig, resolveAmounts } from "../../lib/perspective";
import { formatDollars } from "../../lib/blocks";
import { SITE } from "../../lib/site";
import { bar, C, esc, frame, H, render, W } from "../../lib/og";

export const getStaticPaths: GetStaticPaths = () => [
  { params: { slug: "home" } },
  { params: { slug: "perspective" } },
  ...getDataset().munitions.map((m) => ({ params: { slug: m.id } })),
];

const STATUS_COLOR = { critical: C.critical, serious: C.serious, warning: C.warning, good: C.good } as const;

function homeCard(): string {
  const ds = getDataset();
  const rows = ds.munitions.map((m) => ({ m, h: headline(ds.reports, m.id)! }));
  const f = rows.find((r) => r.m.id === SITE.featured)!;
  const list = rows
    .map(({ m, h }, i) => {
      const y = 150 + i * 56;
      return `<text x="700" y="${y + 18}" font-family="Inter" font-weight="600" font-size="22" fill="${C.ink}">${esc(m.name)}</text>
      ${bar(830, y + 4, 190, 16, h.remaining.low, h.remaining.high, h.prewar, h.qualifier === "at-most")}
      <text x="${W - 64}" y="${y + 18}" text-anchor="end" font-family="Inter" font-size="20" fill="${C.ink2}">${esc(formatPct(h.pctLeft, h.qualifier))}</text>`;
    })
    .join("");
  return frame(`
  <text x="64" y="186" font-family="Inter" font-weight="600" font-size="22" letter-spacing="2" fill="${C.ink3}">${esc(f.m.name.toUpperCase())} INTERCEPTORS LEFT</text>
  <text x="58" y="320" font-family="Inter" font-weight="700" font-size="136" letter-spacing="-5" fill="${C.ink}">${esc(formatRange(f.h.remaining, f.h.qualifier))}</text>
  <text x="64" y="372" font-family="Inter" font-size="26" fill="${C.ink2}">of ~${fmt(f.h.prewar)} before the Iran war</text>
  <text x="64" y="450" font-family="Inter" font-weight="700" font-size="34" fill="${C.ink}">How many missiles does</text>
  <text x="64" y="492" font-family="Inter" font-weight="700" font-size="34" fill="${C.ink}">the U.S. have left?</text>
  <text x="700" y="122" font-family="Inter" font-weight="600" font-size="18" letter-spacing="2" fill="${C.ink3}">SHARE OF PREWAR STOCK LEFT</text>
  ${list}`);
}

function missileCard(id: string): string {
  const ds = getDataset();
  const m = ds.munitionById.get(id as never)!;
  const h = headline(ds.reports, m.id)!;
  const status = stockStatus(h);
  return frame(`
  <text x="64" y="190" font-family="Inter" font-weight="600" font-size="24" letter-spacing="2" fill="${C.ink3}">${esc(m.fullName.toUpperCase().slice(0, 48))}</text>
  <text x="64" y="262" font-family="Inter" font-weight="700" font-size="60" fill="${C.ink}">${esc(m.name)} · estimated left</text>
  <text x="58" y="410" font-family="Inter" font-weight="700" font-size="150" letter-spacing="-6" fill="${C.ink}">${esc(formatRange(h.remaining, h.qualifier))}</text>
  ${bar(64, 448, W - 128, 22, h.remaining.low, h.remaining.high, h.prewar, h.qualifier === "at-most")}
  <text x="64" y="512" font-family="Inter" font-size="26" fill="${C.ink2}">${esc(`${formatPct(h.pctLeft, h.qualifier)} of ~${fmt(h.prewar)} before the war · as of ${formatDate(h.asOf)}`)}</text>
  <circle cx="${W - 300}" cy="${H - 56}" r="9" fill="${STATUS_COLOR[status.level]}"/>
  <text x="${W - 282}" y="${H - 48}" font-family="Inter" font-weight="600" font-size="24" fill="${C.ink}">${esc(status.label)}</text>`);
}

function perspectiveCard(): string {
  const p = getPerspective();
  const a = resolveAmounts(p, getDataset())[0];
  const lunch = p.comparisons[0];
  return frame(`
  <text x="64" y="220" font-family="Inter" font-weight="700" font-size="62" letter-spacing="-1.5" fill="${C.ink}">“They got money for wars,</text>
  <text x="64" y="296" font-family="Inter" font-weight="700" font-size="62" letter-spacing="-1.5" fill="${C.ink}">but can't feed the poor.”</text>
  <text x="64" y="346" font-family="Inter" font-size="26" fill="${C.ink3}">${esc(`— ${p.epigraph.by}`)}</text>
  <text x="64" y="452" font-family="Inter" font-weight="600" font-size="32" fill="${C.ink2}">${esc(`${formatDollars(a.value)} in war costs =`)}</text>
  <text x="64" y="506" font-family="Inter" font-weight="700" font-size="44" fill="${C.blue}">${esc(`${formatBig(a.value / lunch.unitCost)} ${lunch.unit}`)}</text>`);
}

export const GET: APIRoute = ({ params }) => {
  const slug = params.slug!;
  const svg = slug === "home" ? homeCard() : slug === "perspective" ? perspectiveCard() : missileCard(slug);
  return new Response(render(svg), { headers: { "Content-Type": "image/png" } });
};
