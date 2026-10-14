// Loads and validates the JSON data at build time (Astro + Vitest both run on
// Vite, so import.meta.glob works in either). Node scripts use load-node.ts.
import munitionsJson from "../../data/munitions.json";
import { buildDataset, type Dataset } from "./dataset";

const reportModules = import.meta.glob<{ default: unknown }>("../../data/reports/*.json", { eager: true });

let cached: Dataset | undefined;

export function getDataset(): Dataset {
  if (!cached) {
    const reports = Object.entries(reportModules).map(([path, mod]) => ({
      file: path.split("/").pop()!,
      json: mod.default,
    }));
    cached = buildDataset(munitionsJson, reports);
  }
  return cached;
}
