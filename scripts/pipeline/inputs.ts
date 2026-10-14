// Apply model-input proposals (production rates, budget quantities, delivery
// dates) to data/munitions.json. Each change points at the report it came
// from, carries its quote, and lands in the same reviewed pull request.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MunitionsFile, type Munition } from "../../src/lib/schema.ts";
import { ROOT } from "../load-node.ts";
import type { InputUpdate } from "./extract.ts";

export const MUNITIONS_FILE = path.join(ROOT, "data", "munitions.json");

export interface AppliedUpdate extends InputUpdate {
  previous?: number | string;
}

/** Pure: returns the new munitions list plus which updates applied and which were rejected. */
export function applyInputUpdates(munitions: Munition[], updates: InputUpdate[], reportId: string) {
  let current = structuredClone(munitions);
  const applied: AppliedUpdate[] = [];
  const rejected: { update: InputUpdate; reason: string }[] = [];

  for (const u of updates) {
    const next = structuredClone(current);
    const m = next.find((x) => x.id === u.munition)!;
    const previous = (m[u.field] as { value?: number | string } | undefined)?.value;
    if (previous === u.value) {
      rejected.push({ update: u, reason: "already the current value" });
      continue;
    }
    (m as Record<string, unknown>)[u.field] = {
      value: u.value,
      reportId,
      quote: u.quote,
      ...(u.note ? { note: u.note } : {}),
    };
    const check = MunitionsFile.safeParse(next);
    // A rebuild order with no delivery date can't be modeled, so it waits for the date.
    const incomplete = u.field === "fy27Request" && !m.fy27DeliveriesBegin;
    if (!check.success || incomplete) {
      rejected.push({
        update: u,
        reason: incomplete ? "no FY2027 delivery date to go with it" : check.error!.issues[0].message,
      });
      continue;
    }
    current = check.data;
    applied.push({ ...u, previous });
  }
  return { munitions: current, applied, rejected };
}

/** Read munitions.json, apply, write it back if anything changed. */
export function applyToFile(updates: InputUpdate[], reportId: string) {
  const munitions = MunitionsFile.parse(JSON.parse(readFileSync(MUNITIONS_FILE, "utf8")));
  const result = applyInputUpdates(munitions, updates, reportId);
  if (result.applied.length) writeFileSync(MUNITIONS_FILE, `${JSON.stringify(result.munitions, null, 2)}\n`);
  return result;
}
