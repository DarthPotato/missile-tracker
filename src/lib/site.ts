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
