// Shared date ranges (D-029): presets resolved on the India calendar, weeks
// start Monday, both ends inclusive. Pure functions; the picker and every
// section filter use these so "last week" means the same thing everywhere.

import { TIME_ZONE } from "./format.ts";

const IST_OFFSET = "+05:30";

export type RangePreset =
  | "all" | "today" | "yesterday" | "last_7" | "last_30" | "this_week" | "last_week"
  | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "custom";

export const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "custom", label: "Custom dates" },
];

/** Inclusive India calendar dates (YYYY-MM-DD); null = open-ended. */
export interface DateRange { preset: RangePreset; from: string | null; to: string | null }

export const ALL_TIME: DateRange = { preset: "all", from: null, to: null };

export function isPreset(v: string | null | undefined): v is RangePreset {
  return PRESETS.some((p) => p.value === v);
}

const isIsoDate = (v: string | null | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(iso: string, monthsBack = 0): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

function quarterStart(iso: string, quartersBack = 0): string {
  const m = Number(iso.slice(5, 7)) - 1;
  const first = monthStart(iso, m % 3);
  return monthStart(first, quartersBack * 3);
}

/** Resolve a preset against "today" (India). Custom keeps the given dates; swapped ends are put in order. */
export function resolveRange(preset: RangePreset, today: string, custom: { from?: string | null; to?: string | null } = {}): DateRange {
  switch (preset) {
    case "all": return ALL_TIME;
    case "today": return { preset, from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { preset, from: y, to: y }; }
    case "last_7": return { preset, from: addDays(today, -6), to: today };
    case "last_30": return { preset, from: addDays(today, -29), to: today };
    case "this_week": return { preset, from: weekStart(today), to: addDays(weekStart(today), 6) };
    case "last_week": { const s = addDays(weekStart(today), -7); return { preset, from: s, to: addDays(s, 6) }; }
    case "this_month": return { preset, from: monthStart(today), to: addDays(monthStart(today, -1), -1) };
    case "last_month": return { preset, from: monthStart(today, 1), to: addDays(monthStart(today), -1) };
    case "this_quarter": return { preset, from: quarterStart(today), to: addDays(quarterStart(today, -1), -1) };
    case "last_quarter": return { preset, from: quarterStart(today, 1), to: addDays(quarterStart(today), -1) };
    case "custom": {
      const from = isIsoDate(custom.from) ? custom.from : null;
      const to = isIsoDate(custom.to) ? custom.to : null;
      return from && to && from > to ? { preset, from: to, to: from } : { preset, from, to };
    }
  }
}

export const isBounded = (r: DateRange) => Boolean(r.from || r.to);

/** India calendar date of a timestamp; a plain date column passes through unchanged. */
export function indiaDate(value: string): string {
  if (isIsoDate(value)) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/** Is this date/timestamp inside the range? A missing value is outside any bounded range. */
export function inRange(value: string | null | undefined, r: DateRange): boolean {
  if (!isBounded(r)) return true;
  if (!value) return false;
  const d = indiaDate(value);
  return (!r.from || d >= r.from) && (!r.to || d <= r.to);
}

/** Does a period [start, end] touch the range? Missing ends are open-ended. */
export function overlaps(start: string | null | undefined, end: string | null | undefined, r: DateRange): boolean {
  if (!isBounded(r)) return true;
  const s = start ? indiaDate(start) : null;
  const e = end ? indiaDate(end) : null;
  return (!r.to || !s || s <= r.to) && (!r.from || !e || e >= r.from);
}

/** Timestamp bounds for a database query on a timestamptz column (to is exclusive). */
export function timestampBounds(r: DateRange): { gte: string | null; lt: string | null } {
  return {
    gte: r.from ? `${r.from}T00:00:00${IST_OFFSET}` : null,
    lt: r.to ? `${addDays(r.to, 1)}T00:00:00${IST_OFFSET}` : null,
  };
}

const shortFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const fmt = (iso: string) => shortFmt.format(new Date(`${iso}T00:00:00Z`));

export function rangeLabel(r: DateRange): string {
  if (!r.from && !r.to) return "All time";
  if (r.from && r.to) return r.from === r.to ? fmt(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`;
  return r.from ? `From ${fmt(r.from)}` : `Up to ${fmt(r.to!)}`;
}

/** Part of an export file name, e.g. "2026-10-01_to_2026-10-31" or "all-time". */
export function rangeSlug(r: DateRange): string {
  if (!r.from && !r.to) return "all-time";
  return `${r.from ?? "start"}_to_${r.to ?? "today"}`;
}
