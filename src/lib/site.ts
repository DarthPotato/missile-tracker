export const SITE = {
  name: "Missile Tracker",
  tagline: "How many missiles does the U.S. have left?",
  description:
    "Source-linked estimates of the U.S. missile and interceptor stockpile after the 2026 Iran war, and how long it will take to rebuild.",
  repo: "https://github.com/DarthPotato/missile-tracker",
  /** The munition the home page leads with. */
  featured: "patriot",
} as const;

/** Prefix a site-relative path with Astro's configured base. */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Visit counts, by GoatCounter: no cookies, no personal data, no consent banner
 * needed. Off unless the build sets PUBLIC_GOATCOUNTER to the site's code (the
 * "missiletracker" in missiletracker.goatcounter.com). Anything that isn't a
 * plain code is ignored, so a typo can't inject markup.
 */
export function goatcounterCode(raw: string | undefined): string | undefined {
  const code = raw?.trim().toLowerCase();
  return code && /^[a-z0-9][a-z0-9-]{0,49}$/.test(code) ? code : undefined;
}
export const GOATCOUNTER = goatcounterCode(import.meta.env.PUBLIC_GOATCOUNTER);
