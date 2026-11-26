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
/** A Wayback Machine snapshot of a page, kept in case the original changes, disappears or refuses CI. */
const ArchiveUrl = z
  .string()
  .regex(/^https:\/\/web\.archive\.org\/web\/\d{14}\/https?:\/\/.+$/, "expected a Wayback snapshot address");
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
        /** A Wayback Machine snapshot of the page, kept in case the original changes or disappears. */
        archiveUrl: ArchiveUrl.optional(),
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
    /**
     * Missiles delivered between the start of the war and `asOf`, as CSIS
     * counts them in its "inventory today" bars. Added to prewar-minus-used
     * figures; missiles without it get none added.
     */
    deliveredSinceWar: Param.extend({ asOf: isoDate }).optional(),
    /** Announced production capacity, all customers. Caps the model's slider. */
    announcedCapacityPerYear: Param.optional(),
    /** Missiles requested in the FY2027 budget - the big rebuild buy. */
    fy27Request: Param.optional(),
    /** When FY2027-funded missiles start arriving. */
    fy27DeliveriesBegin: MonthParam.optional(),
    /** Months to deliver a full production lot once deliveries start. */
    lotMonths: Param,
    /** The analysts' own stated return-to-prewar timing, shown beside our model's. */
    rebuildOutlook: z
      .object({ text: z.string(), reportId: slug, quote: z.string(), note: z.string().optional() })
      .strict()
      .optional(),
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
    archiveUrl: ArchiveUrl.optional(),
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
          computed: z.enum(["missiles-fired-to-date"]).optional(),
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
    /** Whole national programs, by what one year of each costs: the chart's "how long would it pay for". */
    programs: z.array(
      z
        .object({
          id: slug,
          /** "every school lunch the federal government pays for" */
          name: z.string(),
          annualCost: z.number().positive(),
          /** "FY2025 federal spending" */
          costNote: z.string(),
          source: SourcedFigure.extend({
            /** Some reports print only a month. */
            published: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "expected YYYY-MM or YYYY-MM-DD"),
          }),
        })
        .strict(),
    ),
  })
  .strict();
export type PerspectiveFile = z.infer<typeof PerspectiveFile>;

// ---------------------------------------------------------------------------
// U.S. drone losses (data/drones.json): the Losses page's sourced figures.
// Fleet sizes and loss counts from U.S. officials and the press, plus the
// running tally Iran and the Houthis claim. Quote-checked like everything else;
// the live claim log (data/live/drone-claims.json) adds to the claimed tally.
// ---------------------------------------------------------------------------

export const DRONE_IDS = ["mq9", "mq1"] as const;
export const DroneId = z.enum(DRONE_IDS);
export type DroneId = z.infer<typeof DroneId>;

/** Who a loss figure comes from: U.S. officials, press reporting, or the side claiming the kill. */
export const LossBy = z.enum(["official", "press", "adversary"]);
export type LossBy = z.infer<typeof LossBy>;

const DroneFigure = z
  .object({
    /** The day the figure applies to. */
    asOf: isoDate,
    value: z.number().int().nonnegative(),
    qualifier: z.enum(["exact", "about", "at-least", "at-most"]),
    /** Who stated it, in a few words: "Lt. Gen. David Tabor, to the Senate". */
    by: z.string(),
    note: z.string().optional(),
    /** A loss count that comes on top of the earlier ones, not a new running total. */
    adds: z.boolean().optional(),
    source: SourcedFigure,
  })
  .strict();
export type DroneFigure = z.infer<typeof DroneFigure>;

/** How a U.S. jet was lost: shot down by the enemy, downed by an ally's fire, or hit but brought home. */
export const JetCause = z.enum(["shot-down", "friendly-fire", "damaged"]);
export type JetCause = z.infer<typeof JetCause>;

/** One reported U.S. jet loss, sourced like any other figure. */
const JetLoss = z
  .object({
    date: isoDate,
    /** "F-15E Strike Eagle" */
    model: z.string(),
    count: z.number().int().positive(),
    cause: JetCause,
    /** Who said so: "CENTCOM", "the Pentagon". */
    by: z.string(),
    place: z.string().optional(),
    note: z.string().optional(),
    source: SourcedFigure,
  })
  .strict();
export type JetLoss = z.infer<typeof JetLoss>;

/**
 * Every U.S. aircraft lost or damaged, by any cause, in one official tally (the
 * Congressional Research Service's). Broader than a shoot-down count: it takes
 * in aircraft wrecked on the ground, crashes, friendly fire and damage repaired.
 */
const WarDamage = z
  .object({
    by: z.string(),
    asOf: isoDate,
    total: z.number().int().positive(),
    categories: z.array(
      z
        .object({
          name: z.string(),
          value: z.number().int().positive(),
          /** Types named in the reporting: "45 MQ-9, 3 MQ-1, 1 MQ-4C". */
          detail: z.string().optional(),
        })
        .strict(),
    ),
    note: z.string().optional(),
    sources: z.array(SourcedFigure).min(1),
  })
  .strict()
  .refine((w) => w.categories.reduce((n, c) => n + c.value, 0) === w.total, {
    message: "categories must add up to the total",
  });

export const DronesFile = z
  .object({
    warDamage: WarDamage,
    /** Manned U.S. jets. No fleet math: a few losses don't move a fleet of hundreds. */
    jets: z
      .object({
        blurb: z.string(),
        losses: z.array(JetLoss),
        /** Broader counts, like a Congressional Research Service tally of everything lost or damaged. */
        tallies: z.array(DroneFigure.extend({ kind: LossBy, what: z.string() })),
      })
      .strict(),
    drones: z
      .array(
        z
          .object({
            id: DroneId,
            name: z.string(),
            operator: z.string(),
            blurb: z.string(),
            /** Fleet size before the war, at the start of the fiscal year. Optional: the Army doesn't publish its Gray Eagle fleet. */
            fleetBefore: DroneFigure.optional(),
            /** Later official fleet counts. */
            fleetAfter: z.array(DroneFigure),
            losses: z.array(DroneFigure.extend({ kind: LossBy })),
            /** Why there's no fleet figure, when there isn't one. */
            fleetNote: z.string().optional(),
          })
          .strict(),
      )
      .length(DRONE_IDS.length),
  })
  .strict();
export type DronesFile = z.infer<typeof DronesFile>;
export type Drone = DronesFile["drones"][number];

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

// Aircraft photos for the aircraft losses page, one per type lost or
// damaged in the war: data/aircraft-photos.json, src/assets/photos/aircraft/<id>.jpg.
export const AIRCRAFT_IDS = ["mq9", "mq1c", "f15e", "f35a", "a10", "kc135", "hh60w", "mc130j", "rc135"] as const;
export const AircraftId = z.enum(AIRCRAFT_IDS);
export type AircraftId = z.infer<typeof AircraftId>;
export const AIRCRAFT_NAMES: Record<AircraftId, string> = {
  mq9: "MQ-9 Reaper",
  mq1c: "MQ-1C Gray Eagle",
  f15e: "F-15E Strike Eagle",
  f35a: "F-35A Lightning II",
  a10: "A-10 Thunderbolt II",
  kc135: "KC-135 Stratotanker",
  hh60w: "HH-60W Jolly Green II",
  mc130j: "MC-130J Commando II",
  rc135: "RC-135 Rivet Joint",
};
export const AircraftPhotosFile = z.partialRecord(AircraftId, Photo);
export type AircraftPhotosFile = z.infer<typeof AircraftPhotosFile>;
