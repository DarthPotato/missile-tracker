// Social preview cards (Open Graph, 1200×630), drawn as SVG and rendered to
// PNG at build time. iMessage, Slack, Discord, X and LinkedIn all read these.
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/inter");
const FONTS = ["400Regular/Inter_400Regular.ttf", "600SemiBold/Inter_600SemiBold.ttf", "700Bold/Inter_700Bold.ttf"].map((f) =>
  path.join(FONT_DIR, f),
);

export const W = 1200;
export const H = 630;

// Dark palette from the site's tokens.
export const C = {
  bg: "#0d0d0d",
  surface: "#1a1a19",
  ink: "#f0efec",
  ink2: "#c3c2b7",
  ink3: "#898781",
  blue: "#3987e5",
  blueSoft: "#1c5cab",
  track: "#0d366b",
  critical: "#d03b3b",
  serious: "#ec835a",
  warning: "#fab219",
  good: "#0ca30c",
};

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function render(svg: string, width = W): ArrayBuffer {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" },
  })
    .render()
    .asPng();
  // A standalone ArrayBuffer is a valid Response body under every TS lib version.
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}

/** The frame every card shares: brand top-left, domain bottom-left. */
export function frame(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${C.blue}"/>
  <g transform="translate(64 58)">
    <path d="M12 0l5 10v19l-5 7-5-7V10z" fill="${C.blue}"/>
    <path d="M7 22l-5 7h5zm10 0l5 7h-5z" fill="${C.ink3}"/>
    <text x="36" y="27" font-family="Inter" font-weight="700" font-size="28" fill="${C.ink}">Missile Tracker</text>
  </g>
  ${body}
  <text x="64" y="${H - 48}" font-family="Inter" font-weight="600" font-size="24" fill="${C.ink3}">missiletracker.info</text>
</svg>`;
}

/** A horizontal stock bar: solid to `low`, soft to `high`, track to `max`. */
export function bar(x: number, y: number, w: number, h: number, low: number, high: number, max: number, allSoft = false): string {
  const sx = (v: number) => Math.max(0, Math.min(w, (v / max) * w));
  const solid = allSoft ? 0 : sx(low);
  const soft = sx(high) - solid;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2.5}" fill="${C.track}"/>
  ${solid > 0 ? `<rect x="${x}" y="${y}" width="${solid}" height="${h}" rx="${h / 2.5}" fill="${C.blue}"/>` : ""}
  ${soft > 1 ? `<rect x="${x + solid + (solid > 0 ? 2 : 0)}" y="${y}" width="${Math.max(0, soft - (solid > 0 ? 2 : 0))}" height="${h}" rx="${h / 2.5}" fill="${C.blueSoft}"/>` : ""}`;
}
