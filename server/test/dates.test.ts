import { describe, expect, it } from "vitest";
import { addDays, isDateString, localDate, tzOffsetMinutes, weekday, zonedTimeToUtc } from "../src/lib/dates.js";

describe("dates", () => {
  it("computes local dates in Africa/Douala (UTC+1)", () => {
    expect(localDate(new Date("2026-10-21T23:30:00Z"), "Africa/Douala")).toBe("2026-10-22");
    expect(localDate(new Date("2026-10-21T22:59:00Z"), "Africa/Douala")).toBe("2026-10-21");
    expect(tzOffsetMinutes(new Date("2026-10-21T12:00:00Z"), "Africa/Douala")).toBe(60);
  });

  it("converts wall-clock time to UTC, including DST zones", () => {
    expect(zonedTimeToUtc("2026-10-21", 21, 0, "Africa/Douala").toISOString()).toBe("2026-10-21T20:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-01", 15, 0, "Europe/London").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", 15, 0, "Europe/London").toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekday("2026-10-21")).toBe(3);
    expect(isDateString("2026-10-21")).toBe(true);
    expect(isDateString("21/10/2026")).toBe(false);
  });
});
