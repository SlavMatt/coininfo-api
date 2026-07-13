import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  AssetSnapshotRow,
  FINNHUB_STOCK_SYMBOLS,
  firstMetric,
  formatDate,
  formatNumber,
  jsonHeaders,
  usdCompact,
} from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

async function fetchJson(url: string): Promise<any | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.FINNHUB_API_KEY) {
    return NextResponse.json({ error: "FINNHUB_API_KEY missing" }, { status: 500 });
  }

  const token = process.env.FINNHUB_API_KEY;
  const now = new Date().toISOString();
  const rows: AssetSnapshotRow[] = [];

  for (const [internalSymbol, finnhubSymbol] of Object.entries(FINNHUB_STOCK_SYMBOLS)) {
    const encoded = encodeURIComponent(finnhubSymbol);
    const [profile, metrics] = await Promise.all([
      fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encoded}&token=${token}`),
      fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${encoded}&metric=all&token=${token}`),
    ]);
    const metric = (metrics?.metric ?? {}) as Record<string, unknown>;
    const marketCapMillions = profile?.marketCapitalization ?? firstMetric(metric, ["marketCapitalization"]);
    const shareMillions = profile?.shareOutstanding ?? firstMetric(metric, ["shareOutstanding"]);
    const pe = firstMetric(metric, ["peTTM", "peNormalizedAnnual", "peBasicExclExtraTTM"]);
    const eps = firstMetric(metric, ["epsExclExtraItemsTTM", "epsBasicExclExtraItemsTTM", "epsTTM"]);
    const high52 = firstMetric(metric, ["52WeekHigh", "52WeekHighDate"]);
    const low52 = firstMetric(metric, ["52WeekLow", "52WeekLowDate"]);

    if (!profile?.ticker && marketCapMillions == null && pe == null && eps == null) continue;

    const marketData = [
      { k: "Market Cap", v: marketCapMillions != null ? usdCompact(Number(marketCapMillions) * 1_000_000) : "—" },
      { k: "P/E Ratio", v: pe != null ? formatNumber(pe, 2) : "—" },
      { k: "EPS (TTM)", v: eps != null ? `$${formatNumber(eps, 2)}` : "—" },
      ...(profile?.finnhubIndustry ? [{ k: "Industry", v: String(profile.finnhubIndustry) }] : []),
      ...(profile?.ipo ? [{ k: "IPO Date", v: formatDate(profile.ipo) }] : []),
      { k: "Shares", v: shareMillions != null ? `${formatNumber(Number(shareMillions) * 1_000_000, 0)}` : "—" },
      {
        k: "52W Range",
        v: high52 != null && low52 != null
          ? `$${formatNumber(low52, 2)}–$${formatNumber(high52, 2)}`
          : "—",
      },
    ];

    rows.push({
      asset_key: `${internalSymbol}-PERP`,
      symbol: internalSymbol,
      asset_class: "stock",
      source: "finnhub",
      as_of: now,
      market_data: marketData,
      fields: {},
      source_urls: {
        finnhub: `https://finnhub.io/api/v1/stock/profile2?symbol=${encoded}`,
      },
    });
  }

  if (rows.length === 0) {
    logCronFailure("cron/assets-stock", "no stock rows built");
    return NextResponse.json({ upserted: 0, note: "no stock rows built" });
  }

  const { error } = await db.from("asset_market_snapshots").upsert(rows, { onConflict: "asset_key" });
  if (error) {
    logCronFailure("cron/assets-stock", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r) => r.symbol) }, { headers: jsonHeaders() });
}
