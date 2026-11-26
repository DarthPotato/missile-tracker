import type { APIRoute } from "astro";
import { getDataset } from "../lib/data";
import { xmlEscape } from "../lib/exports";
import { href } from "../lib/site";

export const GET: APIRoute = ({ site }) => {
  const paths = [
    "/",
    "/live/",
    "/live/log/",
    "/reapers/",
    "/perspective/",
    "/methodology/",
    ...getDataset().munitions.map((m) => `/missiles/${m.id}/`),
  ];
  const urls = paths.map((p) => `  <url><loc>${xmlEscape(new URL(href(p), site).href)}</loc></url>`).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
