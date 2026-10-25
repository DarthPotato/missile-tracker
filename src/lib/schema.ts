import { z } from "zod";

// ---------------------------------------------------------------------------
// The data model.
//
// data/munitions.json  - one entry per tracked missile: what it is, plus the
//                        production/delivery parameters the rebuild model uses.
// data/reports/*.json  - one file per source document (a CSIS analysis, a news
//                        story, an IG report). Each holds the claims that
//                        document makes, every one with a verbatim quote.
//
// Nothing on the site is typed in by hand without a report behind it: the
// headline numbers are derived from claims, and every model parameter points
// at the report it came from.
// ---------------------------------------------------------------------------

export const MUNITION_IDS = ["tomahawk", "jassm", "prsm", "sm3", "sm6", "thaad", "patriot"] as const;
export const MunitionId = z.enum(MUNITION_IDS);
export type MunitionId = z.infer<typeof MunitionId>;

/** "all" is for claims about munitions broadly (e.g. an IG cost total). */
export const ClaimTarget = z.union([MunitionId, z.literal("all")]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM");
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase-hyphenated slug");

/**
 * official - on the record from a government body (DoD, IG, CRS, CBO).
 * reported - journalists citing officials, documents or unnamed sources.
 * estimate - an analyst's model built from public data (e.g. CSIS).
 */
export const Confidence = z.enum(["official", "reported", "estimate"]);
export type Confidence = z.infer<typeof Confidence>;

/**
 * prewar       - inventory before the war began (2026-02-28)
 * expended     - cumulative missiles used in the war, as of `asOf`
 * remaining    - inventory on `asOf`
 * pct_expended - share of prewar inventory used, 0-100
 * statement    - a non-numeric claim worth logging ("virtually all used")
 */
export const Metric = z.enum(["prewar", "expended", "remaining", "pct_expended", "statement"]);
export type Metric = z.infer<typeof Metric>;

/** How the source hedged the number: "about 250", "more than 1,000", "nearly 80%". */
export const Qualifier = z.enum(["exact", "about", "at-least", "at-most", "range"]);
export type Qualifier = z.infer<typeof Qualifier>;

export const Claim = z
  .object({
    munition: ClaimTarget,
    metric: Metric,
    low: z.number().nonnegative().optional(),
    high: z.number().nonnegative().optional(),
    qualifier: Qualifier.optional(),
    /** The date the number describes - not the publication date. */
    asOf: isoDate,
    confidence: Confidence,
    /** Verbatim text from the source. The validator checks it against the page. */
    quote: z.string().min(12),
    /** Who the document credits for the number, when it isn't the document itself. */
    attribution: z.string().optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const numeric = c.metric !== "statement";
    if (numeric) {
      if (c.low === undefined || c.high === undefined) {
        ctx.addIssue({ code: "custom", message: `${c.metric} claims need low and high` });
        return;
      }
      if (c.low > c.high) ctx.addIssue({ code: "custom", message: "low must be <= high" });
      if (c.metric === "pct_expended" && c.high > 100)
        ctx.addIssue({ code: "custom", message: "pct_expended is 0-100" });
      if (c.munition === "all") ctx.addIssue({ code: "custom", message: "numeric claims must name a munition" });
      if (!c.qualifier) ctx.addIssue({ code: "custom", message: "numeric claims need a qualifier" });
    } else if (c.low !== undefined || c.high !== undefined) {
      ctx.addIssue({ code: "custom", message: "statement claims carry no numbers" });
    }
  });
export type Claim = z.infer<typeof Claim>;

export const SourceKind = z.enum(["think-tank", "news", "government", "industry"]);

export const Report = z
  .object({
    id: slug,
    source: z
      .object({
        outlet: z.string(),
        title: z.string(),
        url: z.url(),
        published: isoDate,
        authors: z.array(z.string()).optional(),
        kind: SourceKind,
        /** Other addresses for the same document, so the watcher doesn't import it twice. */
        altUrls: z.array(z.url()).optional(),
      })
      .strict(),
    summary: z.string().min(20),
    claims: z.array(Claim),
    /** human = entered by a maintainer; pipeline = drafted by the extractor and approved in review. */
    addedBy: z.enum(["human", "pipeline"]),
    /** Pages we can't fetch (paywalls, PDFs behind auth) skip the automatic quote check. */
    quoteCheck: z.enum(["auto", "manual"]).default("auto"),
    /** For manual checks: how the quotes were verified. */
    quoteCheckNote: z.string().optional(),
  })
  .strict();
export type Report = z.infer<typeof Report>;

/** A model parameter, always tied to the report and words it came from. */
const Param = z
  .object({
    value: z.number().nonnegative(),
    reportId: slug,
    quote: z.string().min(12),
    note: z.string().optional(),
  })
  .strict();
export type Param = z.infer<typeof Param>;

const MonthParam = z
  .object({ value: isoMonth, reportId: slug, quote: z.string().min(12), note: z.string().optional() })
  .strict();

export const Munition = z
  .object({
    id: MunitionId,
    name: z.string(),
    fullName: z.string(),
    role: z.enum(["strike", "air-defense"]),
    operator: z.string(),
    launchedFrom: z.string(),
    blurb: z.string(),
    unitCostM: Param,
    /** Recent U.S. deliveries per year (five-year average of procurement). */
    deliveriesPerYear: Param,
    /** Announced production capacity, all customers. Caps the model's slider. */
    announcedCapacityPerYear: Param.optional(),
    /** Missiles requested in the FY2027 budget - the big rebuild buy. */
    fy27Request: Param.optional(),
    /** When FY2027-funded missiles start arriving. */
    fy27DeliveriesBegin: MonthParam.optional(),
    /** Months to deliver a full production lot once deliveries start. */
    lotMonths: Param,
    /** The analysts' own stated return-to-prewar timing, shown beside our model's. */
    rebuildOutlook: z.object({ text: z.string(), reportId: slug, quote: z.string() }).strict().optional(),
  })
  .strict();
export type Munition = z.infer<typeof Munition>;

export const MunitionsFile = z.array(Munition).length(MUNITION_IDS.length);

// ---------------------------------------------------------------------------
// The perspective page: war costs set against everyday program costs. It's
// opinion in framing, so every figure on it is sourced and quote-checked the
// same way as the tracker's data.
// ---------------------------------------------------------------------------

const SourcedFigure = z
  .object({
    outlet: z.string(),
    title: z.string(),
    url: z.url(),
    published: isoDate,
    quote: z.string().min(12),
    quoteCheck: z.enum(["auto", "manual"]).default("auto"),
  })
  .strict();

export const PerspectiveFile = z
  .object({
    epigraph: z.object({ text: z.string(), by: z.string(), work: z.string() }).strict(),
    amounts: z.array(
      z
        .object({
          id: slug,
          label: z.string(),
          /** USD. Omit for amounts computed from the tracker's own data. */
          value: z.number().positive().optional(),
          computed: z.enum(["missiles-fired-by-ceasefire"]).optional(),
          source: SourcedFigure.optional(),
          note: z.string().optional(),
        })
        .strict()
        .refine((a) => (a.value !== undefined) !== (a.computed !== undefined), "give either value or computed")
        .refine((a) => a.computed !== undefined || a.source !== undefined, "a stated value needs a source"),
    ),
    comparisons: z.array(
      z
        .object({
          id: slug,
          /** Plural noun phrase: "free school lunches". */
          unit: z.string(),
          unitCost: z.number().positive(),
          costNote: z.string(),
          source: SourcedFigure,
        })
        .strict(),
    ),
  })
  .strict();
export type PerspectiveFile = z.infer<typeof PerspectiveFile>;

// ---------------------------------------------------------------------------
// Photos: one public-domain DVIDS image per missile, stored at
// src/assets/photos/<id>.jpg and credited wherever it appears.
// ---------------------------------------------------------------------------

export const Photo = z
  .object({
    dvidsId: z.string().regex(/^\d+$/),
    sourceUrl: z.url(),
    /** Short description for screen readers. */
    alt: z.string().min(10),
    /** The official caption. */
    caption: z.string(),
    /** "David Poe, Fort Bliss Public Affairs Office" */
    credit: z.string().min(3),
    taken: isoDate,
    license: z.literal("public-domain"),
    /** Vertical crop focus, 0 (top) to 100 (bottom). Default 50. */
    focus: z.number().min(0).max(100).optional(),
  })
  .strict();
export type Photo = z.infer<typeof Photo>;

export const PhotosFile = z.partialRecord(MunitionId, Photo);
export type PhotosFile = z.infer<typeof PhotosFile>;
