import type { Headline } from "./model";

export type StatusLevel = "critical" | "serious" | "warning" | "good";

export interface Status {
  level: StatusLevel;
  label: string;
}

/** Severity from the midpoint of the share of prewar stock left. Always shown with a label, never color alone. */
export function stockStatus(h: Headline): Status {
  const pct = (h.pctLeft.low + h.pctLeft.high) / 2;
  if (pct < 40) return { level: "critical", label: "Critically low" };
  if (pct < 65) return { level: "serious", label: "Depleted" };
  if (pct < 85) return { level: "warning", label: "Drawn down" };
  return { level: "good", label: "Near prewar" };
}
