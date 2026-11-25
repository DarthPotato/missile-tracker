import type { APIRoute } from "astro";
import { getDataset } from "../../lib/data";
import { CLAIM_COLUMNS, claimRows, toCsv } from "../../lib/exports";

// Every sourced claim, one per row, with its verbatim quote.
export const GET: APIRoute = () =>
  new Response(toCsv(CLAIM_COLUMNS, claimRows(getDataset())), {
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  });
