import type { APIRoute } from "astro";
import { getDataset } from "../../lib/data";
import { claimRows } from "../../lib/exports";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(claimRows(getDataset()), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
