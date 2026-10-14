import { describe, expect, it } from "vitest";
import { pdfToText, redact } from "../scripts/fetch-text";
import { containsQuote } from "../src/lib/text";

/** A one-page PDF with a single line of text, built in memory (no fixtures, no network). */
function tinyPdf(line: string): ArrayBuffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body).buffer as ArrayBuffer;
}

describe("pdfToText", () => {
  it("extracts text a table-row quote can match", async () => {
    const text = await pdfToText(tinyPdf("Patriot $3.9 2,330 1,060-1,430 42"));
    expect(containsQuote(text, "Patriot $3.9 2,330 1,060–1,430 42")).toBe(true);
  });
});

describe("redact", () => {
  it("drops query strings so API keys never reach logs", () => {
    expect(redact("https://api.nytimes.com/svc/search?q=x&api-key=SECRET")).toBe("https://api.nytimes.com/svc/search?…");
    expect(redact("https://example.com/a")).toBe("https://example.com/a");
    expect(redact("not a url")).toBe("(invalid url)");
  });
});
