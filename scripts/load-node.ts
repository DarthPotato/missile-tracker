// Node-side loader for scripts (the site uses src/lib/data.ts via Vite).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildDataset, type Dataset } from "../src/lib/dataset.ts";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const REPORTS_DIR = path.join(ROOT, "data", "reports");

export function loadDataset(): Dataset {
  const munitions = JSON.parse(readFileSync(path.join(ROOT, "data", "munitions.json"), "utf8"));
  const reports = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, json: JSON.parse(readFileSync(path.join(REPORTS_DIR, file), "utf8")) }));
  return buildDataset(munitions, reports);
}
