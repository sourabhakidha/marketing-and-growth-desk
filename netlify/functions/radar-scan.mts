import type { Config } from "@netlify/functions";
import { requireMember } from "../lib/auth.ts";
import { collectSource, type RadarSource } from "../lib/radar.ts";

// Background function (runs up to 15 min; the browser gets 202 immediately and
// polls marketing_os.radar_scans). Runs AS the member who clicked "Scan now",
// so every write goes through the same RLS rules as the app.
export default async (req: Request) => {
  let me: Awaited<ReturnType<typeof requireMember>>;
  try {
    me = await requireMember(req);
  } catch {
    return;
  }
  const { scanId } = (await req.json().catch(() => ({}))) as { scanId?: string };
  if (!scanId) return;

  const results: { source_id: string; status: string; error?: string; fetched: number; inserted: number }[] = [];
  try {
    const { data: sources, error } = await me.db.from("radar_sources")
      .select("id, kind, name, config, evidence_class").eq("is_active", true);
    if (error) throw new Error(error.message);

    const collected = await Promise.all((sources as RadarSource[]).map((s) => collectSource(s, {
      reddit: {
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        userAgent: process.env.REDDIT_USER_AGENT,
      },
    })));

    for (const r of collected) {
      let inserted = 0;
      let status: string = r.status;
      let errorText = r.error;
      if (r.signals.length) {
        const rows = r.signals.map((s) => ({ ...s, scan_id: scanId, status: "new" }));
        const { data, error: upsertError } = await me.db.from("radar_signals")
          .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true }).select("id");
        if (upsertError) { status = "failed"; errorText = `Saving failed: ${upsertError.message}`; }
        else inserted = data?.length ?? 0;
      }
      results.push({ source_id: r.source_id, status, error: errorText, fetched: r.fetched, inserted });
    }
  } catch (err) {
    console.error("radar scan failed", err instanceof Error ? err.message : "unknown");
  } finally {
    await me.db.rpc("radar_finish_scan", { p_scan: scanId, p_results: results });
  }
};

export const config: Config = { path: "/api/radar-scan", method: ["POST"], background: true };
