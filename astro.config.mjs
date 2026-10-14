// @ts-check
import { defineConfig } from "astro/config";

// SITE_URL / BASE_PATH let the same build serve a custom domain ("/") or a
// GitHub Pages project URL ("/missile-tracker/").
export default defineConfig({
  site: process.env.SITE_URL ?? "https://missiletracker.us",
  base: process.env.BASE_PATH ?? "/",
  trailingSlash: "ignore",
});
