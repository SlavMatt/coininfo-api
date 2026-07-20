import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AssetClass, jsonHeaders, WIKI_TITLES } from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

export const maxDuration = 60;

const UA = { "User-Agent": "CoinInfoBot/1.0 (https://coininfo-tawny.vercel.app)" };

// asset_key -> asset_class, only needed as a fallback when no row exists yet
// (e.g. Indices, which have no live market-data cron and therefore no
// pre-existing row to attach the "about" text to).
const ASSET_CLASS_BY_PREFIX: Array<{ test: RegExp; cls: AssetClass }> = [
  { test: /^(SP500|NDX100)-PERP$/, cls: "index" },
  { test: /^(CL|BZ|XAU|XAG)-PERP$/, cls: "commodity" },
  { test: /.*-PERP$/, cls: "stock" },
];

function classify(assetKey: string): AssetClass {
  return ASSET_CLASS_BY_PREFIX.find((r) => r.test.test(assetKey))?.cls ?? "stock";
}

// Hard cap on the About text length, regardless of what Wikipedia returns.
// The /page/summary endpoint only returns the lead paragraph (not the full
// article) — measured across all 24 current EN assets, the longest is Meta
// Platforms at 691 chars, so 1000 gives headroom without truncating any of
// them today, while still guarding against an unusually long lead paragraph
// on a future asset. Applied uniformly to EN/KO/JA — CJK text is denser per
// character, so 1000 chars of Korean/Japanese is if anything more generous
// than 1000 chars of English, never a risk of under-truncating.
const MAX_ABOUT_CHARS = 1000;

// Cut at the last sentence boundary within the cap. Handles both the Latin
// ". " delimiter and the CJK full-width period "。" used by ja/ko articles.
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastLatin = cut.lastIndexOf(". ");
  const lastCjk = cut.lastIndexOf("。");
  const lastBoundary = Math.max(lastLatin, lastCjk);
  if (lastBoundary > maxChars * 0.5) return cut.slice(0, lastBoundary + 1);
  return cut.trimEnd() + "…";
}

type Summary = { extract: string; pageUrl: string };

async function fetchSummary(lang: string, title: string): Promise<Summary | null> {
  const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.extract) return null;
  return {
    extract: truncateAtSentence(String(data.extract), MAX_ABOUT_CHARS),
    pageUrl: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${title}`,
  };
}

async function fetchEnglishSummaryAndQid(title: string): Promise<(Summary & { qid: string | null }) | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.extract) return null;
  return {
    extract: truncateAtSentence(String(data.extract), MAX_ABOUT_CHARS),
    pageUrl: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${title}`,
    qid: data.wikibase_item ?? null,
  };
}

// One batched Wikidata call for every Q-ID collected in this run, instead of
// one call per asset — Wikidata's own rate limit is tight enough that 24
// sequential calls reliably 429s partway through (confirmed by hand-testing).
// wbgetentities accepts pipe-separated IDs, so this is a single request.
async function fetchKoJaTitles(qids: string[]): Promise<Record<string, { ko?: string; ja?: string }>> {
  if (!qids.length) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=sitelinks&sitefilter=kowiki%7Cjawiki&format=json`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return {};
  const data = await res.json();
  const out: Record<string, { ko?: string; ja?: string }> = {};
  for (const qid of qids) {
    const sitelinks = data.entities?.[qid]?.sitelinks ?? {};
    out[qid] = {
      ko: sitelinks.kowiki?.title,
      ja: sitelinks.jawiki?.title,
    };
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const updated: string[] = [];
  const failures: string[] = [];

  // Pass 1: English summary + Wikidata Q-ID for every asset.
  const enResults: Record<string, (Summary & { qid: string | null }) | null> = {};
  for (const [assetKey, title] of Object.entries(WIKI_TITLES)) {
    try {
      enResults[assetKey] = await fetchEnglishSummaryAndQid(title);
    } catch (err) {
      enResults[assetKey] = null;
      failures.push(`${assetKey} (en): ${err instanceof Error ? err.message : "unknown error"}`);
    }
    await sleep(150);
  }

  // Pass 2: one batched Wikidata lookup for every Q-ID found in pass 1.
  const qids = Object.values(enResults)
    .map((r) => r?.qid)
    .filter((q): q is string => !!q);
  const koJaTitles = await fetchKoJaTitles(qids);

  // Pass 3: KO/JA summaries, using the localized titles from Wikidata —
  // the same company has a different page title per language edition, so
  // the English title can't just be reused on the ko./ja. subdomains.
  for (const [assetKey, title] of Object.entries(WIKI_TITLES)) {
    const en = enResults[assetKey];
    if (!en) {
      failures.push(`${assetKey}: no English extract, skipping`);
      continue;
    }

    const titles = en.qid ? koJaTitles[en.qid] : undefined;
    let koSummary: Summary | null = null;
    let jaSummary: Summary | null = null;

    if (titles?.ko) {
      try {
        koSummary = await fetchSummary("ko", encodeURIComponent(titles.ko));
      } catch (err) {
        failures.push(`${assetKey} (ko): ${err instanceof Error ? err.message : "unknown error"}`);
      }
      await sleep(150);
    }
    if (titles?.ja) {
      try {
        jaSummary = await fetchSummary("ja", encodeURIComponent(titles.ja));
      } catch (err) {
        failures.push(`${assetKey} (ja): ${err instanceof Error ? err.message : "unknown error"}`);
      }
      await sleep(150);
    }

    try {
      const aboutFields: Record<string, string> = {
        about: en.extract,
        aboutSource: "wikipedia",
        aboutUrl: en.pageUrl,
      };
      if (koSummary) {
        aboutFields.about_ko = koSummary.extract;
        aboutFields.aboutUrl_ko = koSummary.pageUrl;
      }
      if (jaSummary) {
        aboutFields.about_ja = jaSummary.extract;
        aboutFields.aboutUrl_ja = jaSummary.pageUrl;
      }

      // Read-merge-write: only touch `fields` and `source_urls`, never
      // overwrite `source` / `market_data`, which belong to the asset's
      // primary live data cron (Finnhub / FRED / Alpha Vantage / none).
      const { data: existing } = await db
        .from("asset_market_snapshots")
        .select("fields, source_urls")
        .eq("asset_key", assetKey)
        .maybeSingle();

      const sourceUrls: Record<string, string> = { ...(existing?.source_urls ?? {}), wikipedia: en.pageUrl };
      if (koSummary) sourceUrls.wikipedia_ko = koSummary.pageUrl;
      if (jaSummary) sourceUrls.wikipedia_ja = jaSummary.pageUrl;

      if (existing) {
        const { error } = await db
          .from("asset_market_snapshots")
          .update({
            fields: { ...(existing.fields ?? {}), ...aboutFields },
            source_urls: sourceUrls,
          })
          .eq("asset_key", assetKey);
        if (error) throw new Error(error.message);
      } else {
        const symbol = assetKey.replace(/-PERP$/, "");
        const { error } = await db.from("asset_market_snapshots").insert({
          asset_key: assetKey,
          symbol,
          asset_class: classify(assetKey),
          source: "static",
          as_of: now,
          market_data: [],
          fields: aboutFields,
          source_urls: sourceUrls,
        });
        if (error) throw new Error(error.message);
      }

      updated.push(assetKey);
    } catch (err) {
      failures.push(`${assetKey}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  if (failures.length) logCronFailure("cron/wiki-about", `${failures.length} wiki fetch(es) failed`, failures);

  return NextResponse.json(
    { updated: updated.length, symbols: updated, failures },
    { headers: jsonHeaders() }
  );
}
