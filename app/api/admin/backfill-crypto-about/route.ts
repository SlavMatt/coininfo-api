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
// English only, from CoinGecko /coins/{id} (English is always populated,
// 16/16 verified). Korean and Japanese are deliberately NOT fetched here —
// CoinGecko's own translations only cover 56%/25% of these 16 coins, and
// spot-checking Wikipedia as a fallback source found real mismatches (e.g.
// "Chainlink" resolves to a Wikipedia article about chain-link *fencing*,
// not the crypto project) that would need per-asset manual verification
// anyway. Given that, about_ko/about_ja are entered by hand for all 16
// rather than trusting any automated source — this route never touches
// those two fields, so a manual entry made once survives every re-run.
const UA = { "User-Agent": "CoinInfoBot/1.0 (https://coininfo-tawny.vercel.app)" };
const COINGECKO_KEY = process.env.COINGECKO_API_KEY;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Description = { en: string; rateLimited: boolean };

async function fetchDescription(coinId: string): Promise<Description | null> {
  const headers: Record<string, string> = { ...UA };
  if (COINGECKO_KEY) headers["x-cg-demo-api-key"] = COINGECKO_KEY;
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`;
  const res = await fetch(url, { headers });
  if (res.status === 429) return { en: "", rateLimited: true };
  if (!res.ok) return null;
  const data = await res.json();
  return { en: String(data.description?.en ?? ""), rateLimited: false };
}

async function writeAbout(assetKey: string, coinId: string, desc: Description) {
  // Only about/aboutSource/aboutUrl — about_ko/about_ja are hand-entered
  // elsewhere and must never be touched by this route.
  const aboutFields: Record<string, string> = {
    about: truncateAtSentence(desc.en, MAX_ABOUT_CHARS),
    aboutSource: "coingecko",
    aboutUrl: `https://www.coingecko.com/en/coins/${coinId}`,
  };

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
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const updated: string[] = [];
  const failures: string[] = [];
  const startedAt = Date.now();
  // Demo key: 100 req/min guaranteed, 1500ms is comfortably under that.
  // No key: the unauthenticated public tier's real limit isn't documented,
  // but hand-testing showed it throttling after ~5-6 requests — 3000ms is
  // a conservative starting point, and backoffMs grows on a 429 anyway.
  let backoffMs = COINGECKO_KEY ? 1500 : 3000;

  for (const [assetKey, coinId] of Object.entries(CRYPTO_COINGECKO_IDS)) {
    // Leave enough budget to finish gracefully before Vercel kills the
    // function at maxDuration=60s, instead of getting cut off mid-write.
    if (Date.now() - startedAt > 50_000) {
      failures.push(`${assetKey}: skipped, out of time budget`);
      continue;
    }

    try {
      let desc = await fetchDescription(coinId);

      if (desc?.rateLimited) {
        backoffMs = Math.min(backoffMs * 2, 10_000);
        await sleep(backoffMs);
        desc = await fetchDescription(coinId);
      }

      if (!desc || desc.rateLimited || !desc.en) {
        failures.push(`${assetKey}: ${desc?.rateLimited ? "rate limited (retry failed)" : "no English description"}`);
        await sleep(backoffMs);
        continue;
      }

      await writeAbout(assetKey, coinId, desc);
      updated.push(assetKey);
    } catch (err) {
      failures.push(`${assetKey}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    await sleep(backoffMs);
  }

  if (failures.length) logCronFailure("admin/backfill-crypto-about", `${failures.length} crypto about fetch(es) failed`, failures);

  return NextResponse.json(
    { updated: updated.length, symbols: updated, failures },
    { headers: jsonHeaders() }
  );
}
