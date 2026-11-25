import type { APIRoute } from "astro";
import { getDataset } from "../../lib/data";
import { headlineRows } from "../../lib/exports";

// The figure each missile's page leads with, and the reports behind it.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(headlineRows(getDataset()), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
