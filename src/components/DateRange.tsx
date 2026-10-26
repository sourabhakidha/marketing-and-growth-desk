// The shared date picker and CSV export button (D-029). The range lives in the
// URL (?range=…&from=…&to=…&on=…) so a link opens the same period, and switching
// between views of a section keeps it.
import { useState } from "react";
import { useSearchParams } from "react-router";
import { downloadCsv, toCsv } from "../lib/csv.ts";
import { type DateRange, isPreset, PRESETS, type RangePreset, rangeLabel, rangeSlug, resolveRange } from "../lib/dateRange.ts";
import type { CsvTable } from "../lib/exportRows.ts";
import { todayInIndia } from "../lib/format.ts";
import { ErrorText } from "./Form.tsx";
import { useScope } from "../lib/scope.tsx";

export interface Basis { value: string; label: string }
export const DATE_PARAMS = ["range", "from", "to", "on"] as const;

export interface DateRangeValue { preset: RangePreset; from: string; to: string; basis: string }

/** Controlled picker: preset, custom dates when chosen, and what the dates apply to. */
export function DateRangePicker({ value, onChange, bases = [], range }: {
  value: DateRangeValue;
  onChange: (patch: Partial<DateRangeValue>) => void;
  bases?: Basis[];
  range: DateRange;
}) {
  return (
    <span className="daterange" role="group" aria-label="Date range">
      <select value={value.preset} onChange={(e) => {
        const preset = e.target.value as RangePreset;
        // starting a custom range from the current period is friendlier than empty boxes
        onChange(preset === "custom" ? { preset, from: range.from ?? value.from, to: range.to ?? value.to } : { preset });
      }} aria-label="Period">
        {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {value.preset === "custom" && (
        <>
          <input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ from: e.target.value })} aria-label="From date" />
          <span className="muted small">to</span>
          <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ to: e.target.value })} aria-label="To date" />
        </>
      )}
      {bases.length > 1 && range.preset !== "all" && (
        <select value={value.basis} onChange={(e) => onChange({ basis: e.target.value })} aria-label="Dates apply to">
          {bases.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      )}
      {range.preset !== "all" && range.preset !== "custom" && <span className="daterange__label small muted">{rangeLabel(range)}</span>}
    </span>
  );
}

/** Date range kept in the URL for sections that don't have their own filter state. */
export function useDateRange(opts: { bases?: Basis[]; defaultPreset?: RangePreset } = {}) {
  const [params, setParams] = useSearchParams();
  const bases = opts.bases ?? [];
  const fallback = opts.defaultPreset ?? "all";
  const raw = params.get("range");
  const value: DateRangeValue = {
    preset: isPreset(raw) ? raw : fallback,
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    basis: bases.find((b) => b.value === params.get("on"))?.value ?? bases[0]?.value ?? "",
  };
  const range = resolveRange(value.preset, todayInIndia(), value);
  const onChange = (patch: Partial<DateRangeValue>) => setParams((p) => {
    const n = new URLSearchParams(p);
    const next = { ...value, ...patch };
    const put = (k: string, v: string, empty: string) => (v && v !== empty ? n.set(k, v) : n.delete(k));
    put("range", next.preset, fallback);
    put("from", next.preset === "custom" ? next.from : "", "");
    put("to", next.preset === "custom" ? next.to : "", "");
    put("on", next.basis, bases[0]?.value ?? "");
    return n;
  }, { replace: true });
  return { value, range, basis: value.basis, onChange, bases };
}

/** Downloads a CSV named after the section and period (e.g. tasks, 1–31 Oct 2026). */
export function ExportCsvButton({ name, range, build, disabled, label = "Export CSV" }: {
  name: string; range: DateRange; build: () => CsvTable | Promise<CsvTable>; disabled?: boolean; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { isMe } = useScope();
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const { columns, rows } = await build();
      downloadCsv(`marketing-desk-${name}${isMe ? "-mine" : ""}-${rangeSlug(range)}-exported-${todayInIndia()}.csv`, toCsv(columns, rows));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="button button--small" disabled={busy || disabled} onClick={go}
        title={`Download what is shown (${rangeLabel(range)}) as a CSV file`}>{busy ? "Preparing…" : label}</button>
      {error != null && <ErrorText error={error} />}
    </>
  );
}
