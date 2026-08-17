import { describe, expect, it } from "vitest";
import { LANES, ZONES, laneOf } from "./village";

describe("laneOf", () => {
  it("maps a lane-named unit to its lane and zone", () => {
    expect(laneOf("Fig Lane 3")?.zone).toBe("the-glades");
    expect(laneOf("Hyrax Lane 1")?.zone).toBe("sunrise-ridge");
  });

  it("returns null for pre-migration unit names, the flat-list fallback", () => {
    expect(laneOf("Woodland Lodge 3")).toBeNull();
    expect(laneOf("Lakeview Lodge 1")).toBeNull();
  });

  it("does not match a lane name without a number after it", () => {
    // "Fig Lane" alone is not a unit name; the prefix must be "<lane> <n>".
    expect(laneOf("Fig Lane")).toBeNull();
    expect(laneOf("Fig Lanes 2")).toBeNull();
  });

  it("every lane belongs to a real zone", () => {
    const zoneIds = new Set(ZONES.map((z) => z.id));
    for (const lane of LANES) {
      expect(zoneIds.has(lane.zone)).toBe(true);
    }
  });
});
