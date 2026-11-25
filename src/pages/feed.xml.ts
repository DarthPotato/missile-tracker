import type { APIRoute } from "astro";
import { getDataset } from "../lib/data";
import { rss } from "../lib/exports";
import { SITE, href } from "../lib/site";

export const GET: APIRoute = ({ site }) =>
  new Response(
    rss(
      getDataset(),
      String(site),
      href,
      `${SITE.name}: new sources`,
      "Each new report added to the stockpile estimates.",
    ),
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
