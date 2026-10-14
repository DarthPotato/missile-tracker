import { MunitionsFile, Report, type Munition, type MunitionId, type Report as ReportT } from "./schema";

export interface Dataset {
  munitions: Munition[];
  reports: ReportT[];
  reportsById: Map<string, ReportT>;
  munitionById: Map<MunitionId, Munition>;
}

/** Every sourced parameter on a munition: unit cost, delivery rates, dates, outlook. */
export function sourcedParams(m: Munition): { key: string; reportId: string; quote: string }[] {
  return Object.entries(m).flatMap(([key, p]) =>
    p && typeof p === "object" && "reportId" in p && "quote" in p ? [{ key, reportId: p.reportId, quote: p.quote }] : [],
  );
}

export class DataError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid data:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * Parse and cross-check everything. Throws DataError listing every problem at
 * once, so a bad pipeline PR fails CI with a readable list.
 */
export function buildDataset(munitionsJson: unknown, reportFiles: { file: string; json: unknown }[]): Dataset {
  const problems: string[] = [];

  const m = MunitionsFile.safeParse(munitionsJson);
  if (!m.success) problems.push(...m.error.issues.map((i) => `munitions.json ${i.path.join(".")}: ${i.message}`));

  const reports: ReportT[] = [];
  for (const { file, json } of reportFiles) {
    const r = Report.safeParse(json);
    if (!r.success) {
      problems.push(...r.error.issues.map((i) => `${file} ${i.path.join(".")}: ${i.message}`));
      continue;
    }
    if (`${r.data.id}.json` !== file) problems.push(`${file}: id "${r.data.id}" must match the file name`);
    reports.push(r.data);
  }

  const reportsById = new Map(reports.map((r) => [r.id, r]));
  if (reportsById.size !== reports.length) problems.push("duplicate report ids");

  const munitions = m.success ? m.data : [];
  const munitionById = new Map(munitions.map((x) => [x.id, x]));
  if (m.success && munitionById.size !== munitions.length) problems.push("munitions.json: duplicate ids");

  for (const mu of munitions) {
    for (const p of sourcedParams(mu)) {
      if (!reportsById.has(p.reportId)) problems.push(`munitions.json ${mu.id}.${p.key}: unknown reportId "${p.reportId}"`);
    }
    if (mu.fy27Request && !mu.fy27DeliveriesBegin) problems.push(`munitions.json ${mu.id}: fy27Request needs fy27DeliveriesBegin`);
  }

  for (const r of reports) {
    for (const c of r.claims) {
      if (c.asOf > r.source.published) problems.push(`${r.id}: claim asOf ${c.asOf} is after the source was published`);
    }
  }

  if (problems.length) throw new DataError(problems);

  reports.sort((a, b) => b.source.published.localeCompare(a.source.published) || a.id.localeCompare(b.id));
  return { munitions, reports, reportsById, munitionById };
}
