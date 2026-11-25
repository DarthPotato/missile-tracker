import type { APIRoute } from "astro";
import { getLive } from "../../lib/data";

// The unverified live intercept log, as the /live/ page reads it.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(getLive(), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
