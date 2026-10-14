// Fetch a source page and return its readable text. Used for quote checks.
// Handles HTML and PDFs (CSIS publishes its main analyses as PDFs).
import { extractText, getDocumentProxy } from "unpdf";
import { htmlToText } from "../src/lib/text.ts";

const UA =
  "Mozilla/5.0 (compatible; missile-tracker/0.1; +https://github.com/DarthPotato/missile-tracker) quote-verifier";

/** A URL safe to print: no query string, which can carry API keys. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    return u.search ? `${u.origin}${u.pathname}?…` : url;
  } catch {
    return "(invalid url)";
  }
}

export async function pdfToText(bytes: ArrayBuffer): Promise<string> {
  // verbosity 0: pdf.js warns about harmless font quirks on stderr otherwise.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/pdf,*/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${redact(url)}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) return pdfToText(await res.arrayBuffer());
  if (!type.includes("html") && !type.includes("text")) throw new Error(`unsupported content-type "${type}" for ${redact(url)}`);
  return htmlToText(await res.text());
}
