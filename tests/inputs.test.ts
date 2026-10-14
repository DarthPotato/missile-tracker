import { describe, expect, it } from "vitest";
import { getDataset } from "../src/lib/data";
import { applyInputUpdates } from "../scripts/pipeline/inputs";

const { munitions } = getDataset();
const quote = "a quote long enough to pass";

describe("applyInputUpdates", () => {
  it("replaces a parameter and points it at the new report", () => {
    const r = applyInputUpdates(
      munitions,
      [{ munition: "thaad", field: "deliveriesPerYear", value: 96, quote }],
      "new-report",
    );
    const thaad = r.munitions.find((m) => m.id === "thaad")!;
    expect(thaad.deliveriesPerYear).toEqual({ value: 96, reportId: "new-report", quote });
    expect(r.applied[0].previous).toBe(28);
    // the input list passed in is untouched
    expect(munitions.find((m) => m.id === "thaad")!.deliveriesPerYear.value).toBe(28);
  });

  it("skips a value that's already current", () => {
    const r = applyInputUpdates(munitions, [{ munition: "thaad", field: "deliveriesPerYear", value: 28, quote }], "x");
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/already/);
  });

  it("won't add a rebuild order without a delivery date", () => {
    const r = applyInputUpdates(munitions, [{ munition: "jassm", field: "fy27Request", value: 821, quote }], "x");
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/delivery date/);
  });

  it("accepts the order once its date arrives in the same batch", () => {
    const r = applyInputUpdates(
      munitions,
      [
        { munition: "jassm", field: "fy27DeliveriesBegin", value: "2030-04", quote },
        { munition: "jassm", field: "fy27Request", value: 821, quote },
      ],
      "x",
    );
    expect(r.applied).toHaveLength(2);
  });
});
