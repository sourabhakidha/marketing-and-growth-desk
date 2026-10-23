// Content Radar collection helpers (Bible §8). Pure functions are unit-tested;
// network functions take an injectable fetch so they can be tested offline.
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export type SourceKind = "news_search" | "rss" | "reddit";
export type EvidenceClass = "official" | "study" | "news_reporting" | "opinion" | "anecdote" | "trend" | "unknown";

export interface RadarSource {
  id: string;
  kind: SourceKind;
  name: string;
  config: { query?: string; region?: string; feed_url?: string; subreddit?: string };
  evidence_class: EvidenceClass;
}

export interface SignalDraft {
  source_id: string;
  source_type: SourceKind;
  source_name: string;
  url: string;
  fingerprint: string;
  title: string;
  excerpt: string | null;
  publisher: string | null;
  published_at: string | null;
  topic_tags: string[];
  region: string;
  evidence_class: EvidenceClass;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------- text helpers
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? safeCodePoint(e.slice(1)) : m))
    .replace(/\s+/g, " ")
    .trim();
}

function safeCodePoint(code: string): string {
  const n = code.startsWith("x") ? parseInt(code.slice(1), 16) : parseInt(code, 10);
  return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
}

export function truncate(text: string, max = 500): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/** Removes tracking parameters and fragments so the same item dedupes across refreshes. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src|igshid)/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

export function fingerprint(kind: string, idOrUrl: string): string {
  return `${kind}:${createHash("sha256").update(idOrUrl.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------- classification (transparent keyword rules)
export const TOPIC_RULES: Record<string, RegExp> = {
  affordability: /\b(price|prices|pricing|cost|costs|costly|expensive|afford|affordable|savings?|cheap|mehang|sasta)\b/i,
  substitutes_generics: /\b(generic|generics|substitute|substitutes|jan aushadhi|janaushadhi|biosimilar|same salt|salt)\b/i,
  chronic_care: /\b(diabetes|diabetic|hypertension|blood pressure|bp|cholesterol|thyroid|heart|cardiac|chronic|kidney|statin)\b/i,
  quality_trust: /\b(fake|counterfeit|spurious|substandard|not of standard quality|nsq|quality|recall|adulterat\w*|trust)\b/i,
  policy_regulation: /\b(nppa|cdsco|dcgi|dpco|price cap|ceiling price|ministry|regulation|regulator|ban|banned|notification|government|policy|rules?)\b/i,
  online_pharmacy: /\b(online pharmacy|e-pharmacy|epharmacy|e pharmacy|medicine delivery|pharmacy app)\b/i,
};

export function tagTopics(text: string): string[] {
  return Object.entries(TOPIC_RULES).filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

const INDIA_RE = /\b(india|indian|bharat|delhi|mumbai|maharashtra|bengaluru|bangalore|chennai|kolkata|hyderabad|pune|gujarat|kerala|tamil nadu|uttar pradesh|rupees?|₹|rs\.?|crore|lakh|nppa|cdsco|ayushman|jan aushadhi)\b/i;

/** Region is a stated rule, not a guess: source scope first, then explicit India mentions. */
export function detectRegion(text: string, sourceRegion?: string): string {
  if (INDIA_RE.test(text)) return "India (mentioned)";
  if (sourceRegion === "IN") return "India (source edition)";
  return "unknown";
}

export function evidenceFor(defaultClass: EvidenceClass, publisherDomain: string | null): EvidenceClass {
  if (publisherDomain && /(\.gov\.in|\.nic\.in|\.gov)$/i.test(publisherDomain)) return "official";
  if (defaultClass === "official") return "news_reporting"; // an "official" query whose result is not on a government domain
  return defaultClass;
}

// ---------------------------------------------------------------- RSS
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

export interface FeedItem { title: string; link: string; guid: string | null; published: string | null; description: string; publisher: string | null; publisherUrl: string | null }

function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) return String((node as Record<string, unknown>)["#text"]);
  return "";
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  const rssItems = channel?.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
  if (rssItems.length) {
    return rssItems.map((it: Record<string, unknown>) => {
      const src = it.source as Record<string, unknown> | string | undefined;
      return {
        title: stripHtml(textOf(it.title)),
        link: textOf(it.link),
        guid: textOf(it.guid) || null,
        published: toIso(textOf(it.pubDate) || textOf(it["dc:date"])),
        description: stripHtml(textOf(it.description)),
        publisher: src ? stripHtml(textOf(src)) || null : null,
        publisherUrl: src && typeof src === "object" ? String(src["@_url"] ?? "") || null : null,
      };
    });
  }
  // Atom
  const feed = doc?.feed;
  const entries = feed?.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
  return entries.map((e: Record<string, unknown>) => {
    const links = Array.isArray(e.link) ? e.link : [e.link];
    const href = (links.find((l: Record<string, unknown>) => !l?.["@_rel"] || l["@_rel"] === "alternate") ?? links[0]) as Record<string, unknown> | undefined;
    return {
      title: stripHtml(textOf(e.title)),
      link: String(href?.["@_href"] ?? ""),
      guid: textOf(e.id) || null,
      published: toIso(textOf(e.published) || textOf(e.updated)),
      description: stripHtml(textOf(e.summary) || textOf(e.content)),
      publisher: stripHtml(textOf(feed?.title)) || null,
      publisherUrl: null,
    };
  });
}

export function googleNewsUrl(query: string, region = "IN"): string {
  const hl = region === "IN" ? "en-IN" : "en";
  const ceid = region === "IN" ? "IN:en" : "US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${region}&ceid=${ceid}`;
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

export function feedItemsToSignals(source: RadarSource, items: FeedItem[]): SignalDraft[] {
  const out: SignalDraft[] = [];
  for (const it of items) {
    const url = it.link ? normalizeUrl(it.link) : null;
    if (!url || !it.title) continue;
    // Google News titles end with " - Publisher"; keep the publisher separately
    let title = it.title;
    if (it.publisher && title.endsWith(` - ${it.publisher}`)) title = title.slice(0, -(it.publisher.length + 3));
    const excerptRaw = it.description && it.description !== it.title ? it.description : "";
    const text = `${title} ${excerptRaw}`;
    out.push({
      source_id: source.id,
      source_type: source.kind,
      source_name: source.name,
      url,
      fingerprint: fingerprint(source.kind, it.guid || url),
      title: truncate(title, 300),
      excerpt: excerptRaw ? truncate(excerptRaw, 500) : null,
      publisher: it.publisher ?? domainOf(url),
      published_at: it.published,
      topic_tags: tagTopics(text),
      region: detectRegion(text, source.config.region),
      evidence_class: evidenceFor(source.evidence_class, domainOf(it.publisherUrl) ?? (source.kind === "rss" ? domainOf(url) : null)),
    });
  }
  return out;
}

// ---------------------------------------------------------------- Reddit
export interface RedditPost { id: string; title: string; selftext?: string; permalink: string; created_utc: number; subreddit: string; over_18?: boolean }

export function redditPostsToSignals(source: RadarSource, posts: RedditPost[]): SignalDraft[] {
  return posts
    .filter((p) => !p.over_18 && p.title)
    .map((p) => {
      const url = `https://www.reddit.com${p.permalink}`;
      // Usernames are not stored (Bible §18.1: no personal data beyond what is necessary)
      const excerpt = p.selftext ? truncate(stripHtml(p.selftext).replace(/\bu\/[A-Za-z0-9_-]+/g, "a user"), 500) : null;
      const text = `${p.title} ${excerpt ?? ""}`;
      return {
        source_id: source.id,
        source_type: "reddit" as const,
        source_name: source.name,
        url,
        fingerprint: fingerprint("reddit", p.id),
        title: truncate(stripHtml(p.title), 300),
        excerpt,
        publisher: `r/${p.subreddit}`,
        published_at: toIso(p.created_utc),
        topic_tags: tagTopics(text),
        region: detectRegion(text, undefined),
        evidence_class: "anecdote" as const,
      };
    });
}

// ---------------------------------------------------------------- network
export interface SourceResult { source_id: string; status: "ok" | "empty" | "failed" | "not_configured"; error?: string; fetched: number; signals: SignalDraft[] }

const UA = "AkidhaMarketingDesk/1.0 (internal research tool)";

async function fetchText(fetcher: FetchLike, url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: { "user-agent": UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export interface RedditCredentials { clientId?: string; clientSecret?: string; userAgent?: string }

let redditToken: { value: string; expires: number } | null = null;

async function redditAuth(fetcher: FetchLike, creds: RedditCredentials): Promise<string> {
  if (redditToken && redditToken.expires > Date.now() + 60_000) return redditToken.value;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetcher("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": creds.userAgent || UA },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit auth HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Reddit auth returned no token");
  redditToken = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return redditToken.value;
}

export async function collectSource(source: RadarSource, opts: { fetcher?: FetchLike; reddit?: RedditCredentials; timeoutMs?: number } = {}): Promise<SourceResult> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const base = { source_id: source.id, fetched: 0, signals: [] as SignalDraft[] };
  try {
    if (source.kind === "news_search" || source.kind === "rss") {
      const url = source.kind === "news_search"
        ? source.config.query ? googleNewsUrl(source.config.query, source.config.region) : null
        : source.config.feed_url ?? null;
      if (!url) return { ...base, status: "failed", error: "Source has no query or feed URL" };
      const items = parseFeed(await fetchText(fetcher, url, timeoutMs)).slice(0, 40);
      const signals = feedItemsToSignals(source, items);
      return { ...base, status: signals.length ? "ok" : "empty", fetched: signals.length, signals };
    }
    if (source.kind === "reddit") {
      if (!opts.reddit?.clientId || !opts.reddit?.clientSecret) {
        return { ...base, status: "not_configured", error: "Reddit credentials are not set in Netlify (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET)" };
      }
      const sub = (source.config.subreddit ?? "").replace(/[^A-Za-z0-9_]/g, "");
      if (!sub) return { ...base, status: "failed", error: "Source has no subreddit" };
      const token = await redditAuth(fetcher, opts.reddit);
      const path = source.config.query
        ? `/r/${sub}/search?q=${encodeURIComponent(source.config.query)}&restrict_sr=1&sort=new&t=month&limit=25`
        : `/r/${sub}/new?limit=25`;
      const body = await fetchText(fetcher, `https://oauth.reddit.com${path}`, timeoutMs,
        { authorization: `Bearer ${token}`, "user-agent": opts.reddit.userAgent || UA });
      const json = JSON.parse(body) as { data?: { children?: { data: RedditPost }[] } };
      const signals = redditPostsToSignals(source, (json.data?.children ?? []).map((c) => c.data));
      return { ...base, status: signals.length ? "ok" : "empty", fetched: signals.length, signals };
    }
    return { ...base, status: "failed", error: `Unknown source kind ${source.kind}` };
  } catch (err) {
    const message = err instanceof Error ? (err.name === "AbortError" ? "Timed out" : err.message) : "Unknown error";
    return { ...base, status: "failed", error: message.slice(0, 300) };
  }
}
