// @ts-check
import { defineConfig } from "astro/config";

// SITE_URL / BASE_PATH let the same build serve a custom domain ("/") or a
// GitHub Pages project URL ("/missile-tracker/").
export default defineConfig({
  site: process.env.SITE_URL ?? "https://missiletracker.info",
  base: process.env.BASE_PATH ?? "/",
  trailingSlash: "ignore",
  // The losses page used to be /reapers/; old links still land on it.
  redirects: { "/reapers": `${(process.env.BASE_PATH ?? "/").replace(/\/?$/, "/")}losses/` },
  // Native module used to render share images at build time; keep it out of the bundle.
  vite: { ssr: { external: ["@resvg/resvg-js"] } },
});
