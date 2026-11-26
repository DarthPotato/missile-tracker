import { describe, expect, it } from "vitest";
import { goatcounterCode } from "../src/lib/site";

describe("goatcounterCode", () => {
  it("accepts a plain site code", () => {
    expect(goatcounterCode("missiletracker")).toBe("missiletracker");
    expect(goatcounterCode(" Missile-Tracker ")).toBe("missile-tracker");
  });
  it("is off when unset or not a plain code", () => {
    expect(goatcounterCode(undefined)).toBeUndefined();
    expect(goatcounterCode("")).toBeUndefined();
    expect(goatcounterCode('x" onload="alert(1)')).toBeUndefined();
    expect(goatcounterCode("https://missiletracker.goatcounter.com")).toBeUndefined();
  });
});
