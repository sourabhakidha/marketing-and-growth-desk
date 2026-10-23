import { describe, expect, it } from "vitest";
import {
  collectSource, detectRegion, evidenceFor, feedItemsToSignals, fingerprint, googleNewsUrl, normalizeUrl,
  parseFeed, redditPostsToSignals, stripHtml, tagTopics, type RadarSource,
} from "./radar.ts";

const news: RadarSource = { id: "s1", kind: "news_search", name: "News", config: { query: "generic medicines India", region: "IN" }, evidence_class: "news_reporting" };
const official: RadarSource = { ...news, id: "s2", name: "Official", evidence_class: "official" };

const RSS = `<?xml version="1.0"?><rss><channel><title>t</title>
<item><title>NPPA caps prices of 40 formulations - The Hindu</title><link>https://news.google.com/rss/articles/abc?oc=5&amp;utm_source=x</link>
<guid isPermaLink="false">abc123</guid><pubDate>Thu, 23 Oct 2026 08:00:00 GMT</pubDate>
<description>&lt;a href="x"&gt;NPPA caps prices&lt;/a&gt;&amp;nbsp;The Hindu</description><source url="https://www.thehindu.com">The Hindu</source></item>
<item><title>PIB: Jan Aushadhi Kendras cross milestone - PIB</title><link>https://news.google.com/rss/articles/def</link>
<guid>def456</guid><pubDate>Wed, 22 Oct 2026 05:30:00 GMT</pubDate><source url="https://pib.gov.in">PIB</source></item>
</channel></rss>`;

describe("text helpers", () => {
  it("strips tags and decodes entities", () => expect(stripHtml("<b>Hi</b>&nbsp;&amp; &#8377;5")).toBe("Hi & ₹5"));
  it("removes tracking params and rejects non-http links", () => {
    expect(normalizeUrl("https://Site.com/a?utm_source=x&id=2#top")).toBe("https://site.com/a?id=2");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("fingerprints are stable and case-insensitive", () => expect(fingerprint("rss", "ABC")).toBe(fingerprint("rss", "abc")));
  it("tags topics with explicit keyword rules", () => {
    expect(tagTopics("NPPA price cap on diabetes drugs")).toEqual(expect.arrayContaining(["affordability", "policy_regulation", "chronic_care"]));
    expect(tagTopics("cricket score")).toEqual([]);
  });
  it("region follows a stated rule", () => {
    expect(detectRegion("Mumbai patients", undefined)).toBe("India (mentioned)");
    expect(detectRegion("Patients", "IN")).toBe("India (source edition)");
    expect(detectRegion("Patients", undefined)).toBe("unknown");
  });
  it("government domains are official; official queries elsewhere are reporting", () => {
    expect(evidenceFor("news_reporting", "pib.gov.in")).toBe("official");
    expect(evidenceFor("official", "thehindu.com")).toBe("news_reporting");
  });
  it("builds an India-edition Google News query", () => {
    expect(googleNewsUrl("Jan Aushadhi")).toBe("https://news.google.com/rss/search?q=Jan%20Aushadhi&hl=en-IN&gl=IN&ceid=IN:en");
  });
});

describe("feeds", () => {
  it("parses RSS into signals with provenance", () => {
    const signals = feedItemsToSignals(official, parseFeed(RSS));
    expect(signals).toHaveLength(2);
    const [a, b] = signals;
    expect(a!.title).toBe("NPPA caps prices of 40 formulations");
    expect(a!.publisher).toBe("The Hindu");
    expect(a!.url).not.toContain("utm_source");
    expect(a!.published_at).toBe("2026-10-23T08:00:00.000Z");
    expect(a!.evidence_class).toBe("news_reporting");
    expect(b!.evidence_class).toBe("official");
    expect(a!.fingerprint).not.toBe(b!.fingerprint);
  });
  it("keeps unknown publication dates unknown", () => {
    const signals = feedItemsToSignals(news, parseFeed(`<rss><channel><item><title>X</title><link>https://a.in/x</link></item></channel></rss>`));
    expect(signals[0]!.published_at).toBeNull();
  });
  it("parses Atom", () => {
    const atom = `<feed><title>Ministry</title><entry><id>e1</id><title>Notice</title><link href="https://mohfw.gov.in/n1"/><updated>2026-10-20T10:00:00Z</updated></entry></feed>`;
    const rssSource: RadarSource = { ...news, kind: "rss", config: { feed_url: "https://mohfw.gov.in/feed" } };
    const [s] = feedItemsToSignals(rssSource, parseFeed(atom));
    expect(s!.url).toBe("https://mohfw.gov.in/n1");
    expect(s!.evidence_class).toBe("official");
  });
});

describe("reddit", () => {
  it("drops usernames and NSFW posts", () => {
    const src: RadarSource = { id: "r", kind: "reddit", name: "r/india", config: { subreddit: "india" }, evidence_class: "anecdote" };
    const out = redditPostsToSignals(src, [
      { id: "1", title: "Is generic medicine safe?", selftext: "My doctor u/drsomeone said…", permalink: "/r/india/comments/1/x/", created_utc: 1792800000, subreddit: "india" },
      { id: "2", title: "nsfw", permalink: "/r/india/2", created_utc: 1, subreddit: "india", over_18: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.excerpt).not.toContain("drsomeone");
    expect(out[0]!.evidence_class).toBe("anecdote");
  });
});

describe("collectSource", () => {
  it("reports failures instead of an empty success", async () => {
    const res = await collectSource(news, { fetcher: async () => new Response("nope", { status: 503 }) });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("503");
  });
  it("reports Reddit as not configured without credentials", async () => {
    const res = await collectSource({ id: "r", kind: "reddit", name: "r", config: { subreddit: "india" }, evidence_class: "anecdote" });
    expect(res.status).toBe("not_configured");
  });
  it("returns ok with signals for a working feed", async () => {
    const res = await collectSource(news, { fetcher: async () => new Response(RSS, { status: 200 }) });
    expect(res.status).toBe("ok");
    expect(res.fetched).toBe(2);
  });
});
