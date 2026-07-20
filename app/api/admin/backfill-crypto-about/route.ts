import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CRYPTO_COINGECKO_IDS, MAX_ABOUT_CHARS, jsonHeaders, truncateAtSentence } from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

export const maxDuration = 60;

// Manual, one-time-ish backfill for Crypto About text — NOT on a recurring
// schedule (no vercel.json entry). A project's "what is X" description
// barely ever changes, so unlike market data this doesn't need automatic
// re-fetching; re-run this endpoint by hand if it's ever needed again (new
// coin listed, or someone wants to force a refresh).
//
// Source: CoinGecko /coins/{id}?localization=true, same API family already
// used for crypto market data. Coverage found by hand-testing all 16 live
// pairs: EN 16/16, KO 9/16, JA 4/16 — missing languages are simply left
// unset here; fill them in by hand (UPDATE ... SET fields = fields ||
// '{"about_ko": "..."}' in the Supabase SQL editor, or a future admin route)
// rather than machine-translating.

const UA = { "User-Agent": "CoinInfoBot/1.0 (https://coininfo-tawny.vercel.app)" };
const COINGECKO_KEY = process.env.COINGECKO_API_KEY;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchDescriptions(coinId: string): Promise<{ en: string; ko: string; ja: string } | null> {
  const headers: Record<string, string> = { ...UA };
  if (COINGECKO_KEY) headers["x-cg-demo-api-key"] = COINGECKO_KEY;
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=true&tickers=false&market_data=false&community_data=false&developer_data=false`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  const desc = data.description ?? {};
  return { en: String(desc.en ?? ""), ko: String(desc.ko ?? ""), ja: String(desc.ja ?? "") };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const updated: string[] = [];
  const failures: string[] = [];

  for (const [assetKey, coinId] of Object.entries(CRYPTO_COINGECKO_IDS)) {
    try {
      const desc = await fetchDescriptions(coinId);
      if (!desc || !desc.en) {
        failures.push(`${assetKey}: no English description`);
        await sleep(200);
        continue;
      }

      const aboutFields: Record<string, string> = {
        about: truncateAtSentence(desc.en, MAX_ABOUT_CHARS),
        aboutSource: "coingecko",
        aboutUrl: `https://www.coingecko.com/en/coins/${coinId}`,
      };
      if (desc.ko) aboutFields.about_ko = truncateAtSentence(desc.ko, MAX_ABOUT_CHARS);
      if (desc.ja) aboutFields.about_ja = truncateAtSentence(desc.ja, MAX_ABOUT_CHARS);

      const { data: existing } = await db
        .from("asset_market_snapshots")
        .select("fields, source_urls")
        .eq("asset_key", assetKey)
        .maybeSingle();

      const sourceUrls = { ...(existing?.source_urls ?? {}), coingecko: aboutFields.aboutUrl };

      if (existing) {
        const { error } = await db
          .from("asset_market_snapshots")
          .update({ fields: { ...(existing.fields ?? {}), ...aboutFields }, source_urls: sourceUrls })
          .eq("asset_key", assetKey);
        if (error) throw new Error(error.message);
      } else {
        const symbol = assetKey.replace(/-PERP$/, "");
        const { error } = await db.from("asset_market_snapshots").insert({
          asset_key: assetKey,
          symbol,
          asset_class: "crypto",
          source: "coingecko",
          as_of: new Date().toISOString(),
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
    await sleep(COINGECKO_KEY ? 1500 : 3000); // avoid the public-tier rate limit
  }

  if (failures.length) logCronFailure("admin/backfill-crypto-about", `${failures.length} crypto about fetch(es) failed`, failures);

  return NextResponse.json(
    { updated: updated.length, symbols: updated, failures },
    { headers: jsonHeaders() }
  );
}
