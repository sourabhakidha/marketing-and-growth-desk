import { describe, expect, it } from "vitest";
import { ALL_TIME, indiaDate, inRange, overlaps, rangeLabel, rangeSlug, resolveRange, timestampBounds, weekStart } from "./dateRange.ts";

// 2026-10-25 is a Sunday
const today = "2026-10-25";

describe("resolveRange", () => {
  it("weeks start on Monday", () => {
    expect(weekStart(today)).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(resolveRange("this_week", today)).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
    expect(resolveRange("last_week", today)).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
  });
  it("resolves days, months and quarters on calendar boundaries", () => {
    expect(resolveRange("yesterday", today)).toMatchObject({ from: "2026-10-24", to: "2026-10-24" });
    expect(resolveRange("last_7", today)).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
    expect(resolveRange("this_month", today)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveRange("last_month", today)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRange("this_quarter", today)).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolveRange("last_quarter", today)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(resolveRange("last_month", "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRange("this_month", "2028-02-10")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("keeps custom dates, orders swapped ends, ignores junk", () => {
    expect(resolveRange("custom", today, { from: "2026-10-31", to: "2026-10-01" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveRange("custom", today, { from: "nope", to: "2026-10-01" })).toMatchObject({ from: null, to: "2026-10-01" });
  });
});

describe("inRange / overlaps", () => {
  const oct = resolveRange("this_month", today);
  it("uses the India calendar day of a timestamp", () => {
    expect(indiaDate("2026-09-30T19:00:00Z")).toBe("2026-10-01"); // 00:30 IST on 1 Oct
    expect(inRange("2026-09-30T19:00:00Z", oct)).toBe(true);
    expect(inRange("2026-09-30T18:00:00Z", oct)).toBe(false); // 23:30 IST on 30 Sep
    expect(inRange("2026-10-31", oct)).toBe(true);
  });
  it("treats missing values as outside a bounded range, inside all time", () => {
    expect(inRange(null, oct)).toBe(false);
    expect(inRange(null, ALL_TIME)).toBe(true);
  });
  it("matches periods that touch the range; missing ends are open", () => {
    expect(overlaps("2026-09-15", "2026-10-02", oct)).toBe(true);
    expect(overlaps("2026-11-01", null, oct)).toBe(false);
    expect(overlaps(null, null, oct)).toBe(true);
    expect(overlaps(null, "2026-09-30", oct)).toBe(false);
  });
});

describe("query bounds and labels", () => {
  it("turns India dates into timestamp bounds with an exclusive end", () => {
    expect(timestampBounds(resolveRange("today", today))).toEqual({ gte: "2026-10-25T00:00:00+05:30", lt: "2026-10-26T00:00:00+05:30" });
    expect(timestampBounds(ALL_TIME)).toEqual({ gte: null, lt: null });
  });
  it("names the period for people and files", () => {
    expect(rangeSlug(resolveRange("last_week", today))).toBe("2026-10-12_to_2026-10-18");
    expect(rangeSlug(ALL_TIME)).toBe("all-time");
    expect(rangeLabel(ALL_TIME)).toBe("All time");
    expect(rangeLabel(resolveRange("today", today))).toMatch(/25 Oct 2026/);
  });
});
