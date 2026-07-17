import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AssetClass, jsonHeaders, WIKI_TITLES } from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

export const maxDuration = 60;

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
// article), so this rarely trims anything in practice — but a few topics
// have unusually long lead paragraphs, and this guarantees consistent
// length across all 24 assets rather than relying on that being true.
const MAX_ABOUT_CHARS = 500;

function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastPeriod = cut.lastIndexOf(". ");
  if (lastPeriod > maxChars * 0.5) return cut.slice(0, lastPeriod + 1);
  return cut.trimEnd() + "…";
}

async function fetchSummary(title: string): Promise<{ extract: string; pageUrl: string } | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, {
    headers: { "User-Agent": "CoinInfoBot/1.0 (https://coininfo-tawny.vercel.app)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.extract) return null;
  return {
    extract: truncateAtSentence(String(data.extract), MAX_ABOUT_CHARS),
    pageUrl: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${title}`,
  };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const updated: string[] = [];
  const failures: string[] = [];

  for (const [assetKey, title] of Object.entries(WIKI_TITLES)) {
    try {
      const summary = await fetchSummary(title);
      if (!summary) {
        failures.push(`${assetKey}: no extract`);
        continue;
      }

      // Read-merge-write: only touch `fields` and `source_urls`, never
      // overwrite `source` / `market_data`, which belong to the asset's
      // primary live data cron (Finnhub / FRED / Alpha Vantage / none).
      const { data: existing } = await db
        .from("asset_market_snapshots")
        .select("fields, source_urls")
        .eq("asset_key", assetKey)
        .maybeSingle();

      const aboutFields = {
        about: summary.extract,
        aboutSource: "wikipedia",
        aboutUrl: summary.pageUrl,
      };

      if (existing) {
        const { error } = await db
          .from("asset_market_snapshots")
          .update({
            fields: { ...(existing.fields ?? {}), ...aboutFields },
            source_urls: { ...(existing.source_urls ?? {}), wikipedia: summary.pageUrl },
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
          source_urls: { wikipedia: summary.pageUrl },
        });
        if (error) throw new Error(error.message);
      }

      updated.push(assetKey);
    } catch (err) {
      failures.push(`${assetKey}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    // Wikipedia REST API rate limit courtesy delay
    await new Promise((r) => setTimeout(r, 150));
  }

  if (failures.length) logCronFailure("cron/wiki-about", `${failures.length} wiki fetch(es) failed`, failures);

  return NextResponse.json(
    { updated: updated.length, symbols: updated, failures },
    { headers: jsonHeaders() }
  );
}
