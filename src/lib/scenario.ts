import type { Munition } from "./schema";
import { defaultRebuildPerYear, type Headline, type ProjectionInput } from "./model";

export const PROJECTION_END = "2032-12-31";

export interface ScenarioOptions {
  deliveriesPerYear?: number;
  includeRebuild?: boolean;
  war?: ProjectionInput["war"];
}

/** The projection inputs for a munition, from its sourced parameters plus any user overrides. */
export function scenarioInput(m: Munition, h: Headline, opts: ScenarioOptions = {}): ProjectionInput {
  const perYear = defaultRebuildPerYear(m);
  const includeRebuild = opts.includeRebuild ?? true;
  return {
    start: { date: h.asOf, ...h.remaining },
    prewar: h.prewar,
    deliveriesPerYear: opts.deliveriesPerYear ?? m.deliveriesPerYear.value,
    rebuild:
      includeRebuild && perYear && m.fy27Request && m.fy27DeliveriesBegin
        ? { quantity: m.fy27Request.value, begin: m.fy27DeliveriesBegin.value, perYear }
        : undefined,
    war: opts.war,
    end: PROJECTION_END,
  };
}

/** Build date, used as "today" on the static site. */
export const BUILD_DATE = new Date().toISOString().slice(0, 10);
