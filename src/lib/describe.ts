import type { Claim, MunitionId } from "./schema";
import { formatPct, formatRange } from "./format";

export const METRIC_LABEL: Record<Claim["metric"], string> = {
  prewar: "Prewar stock",
  expended: "Used in the war",
  remaining: "Left",
  pct_expended: "Share used",
  statement: "Statement",
};

export const CONFIDENCE_LABEL = { official: "Official", reported: "Reported", estimate: "Estimate" } as const;

export const SHORT_NAME: Record<MunitionId | "all", string> = {
  tomahawk: "Tomahawk",
  jassm: "JASSM",
  prsm: "PrSM",
  sm3: "SM-3",
  sm6: "SM-6",
  thaad: "THAAD",
  patriot: "Patriot",
  all: "All munitions",
};

/** "759–827 left", "≥1,000 used", "~80% used", "~2,330 before the war" */
export function describeClaim(c: Claim): string {
  if (c.metric === "statement") return "";
  const r = { low: c.low!, high: c.high! };
  switch (c.metric) {
    case "remaining":
      return `${formatRange(r, c.qualifier!)} left`;
    case "expended":
      return `${formatRange(r, c.qualifier!)} used`;
    case "pct_expended":
      return `${formatPct(r, c.qualifier!)} used`;
    case "prewar":
      return `${formatRange(r, c.qualifier!)} before the war`;
  }
}
