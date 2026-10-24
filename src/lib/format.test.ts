import { describe, expect, it } from "vitest";
import { formatDuration, isOverdue, median, minutesBetween, todayInIndia } from "./format.ts";

describe("format", () => {
  it("uses the India calendar day", () => {
    // 20:00 UTC on 23 Oct is already 24 Oct in India
    expect(todayInIndia(new Date("2026-10-23T20:00:00Z"))).toBe("2026-10-24");
  });
  it("never invents durations", () => {
    expect(minutesBetween(null, "2026-10-24T10:00:00Z")).toBeNull();
    expect(minutesBetween("2026-10-24T10:00:00Z", "2026-10-24T11:30:00Z")).toBe(90);
    expect(formatDuration(null)).toBe("not tracked");
    expect(formatDuration(90)).toBe("1.5 h");
  });
  it("flags overdue open tasks only", () => {
    expect(isOverdue("2026-10-20", "in_progress", "2026-10-24")).toBe(true);
    expect(isOverdue("2026-10-20", "done", "2026-10-24")).toBe(false);
    expect(isOverdue(null, "in_progress", "2026-10-24")).toBe(false);
  });
  it("takes the median of recorded values and returns null, not zero, for no data", () => {
    expect(median([240, 120])).toBe(180);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});
