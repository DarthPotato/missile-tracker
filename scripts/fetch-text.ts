// Fetch a source page and return its readable text. Used for quote checks.
import { htmlToText } from "../src/lib/text.ts";

const UA =
  "Mozilla/5.0 (compatible; missile-tracker/0.1; +https://github.com/DarthPotato/missile-tracker) quote-verifier";

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text")) throw new Error(`unsupported content-type "${type}" for ${url}`);
  return htmlToText(await res.text());
}
