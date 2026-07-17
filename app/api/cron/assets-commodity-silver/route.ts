import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AssetSnapshotRow, formatNumber, jsonHeaders, preserveAboutFields } from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

export const maxDuration = 60;

function oneYearRange(points: Array<{ date: string; price: number }>): string | null {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const values = points.filter((point) => new Date(point.date) >= cutoff).map((point) => point.price);
  if (!values.length) return null;
  return `$${formatNumber(Math.min(...values), 2)}-$${formatNumber(Math.max(...values), 2)}`;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ALPHA_VANTAGE_KEY) {
    return NextResponse.json({ error: "ALPHA_VANTAGE_KEY missing" }, { status: 503 });
  }

  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "GOLD_SILVER_HISTORY");
  url.searchParams.set("symbol", "SILVER");
  url.searchParams.set("interval", "daily");
  url.searchParams.set("apikey", process.env.ALPHA_VANTAGE_KEY);

  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: `Alpha Vantage HTTP ${res.status}` }, { status: 502 });
  const data: { data?: Array<{ date?: string; price?: string }>; Information?: string; Note?: string } = await res.json();
  if (data.Information || data.Note) {
    logCronFailure("cron/assets-commodity-silver", "Alpha Vantage rate limited");
    return NextResponse.json({ error: "Alpha Vantage rate limited" }, { status: 429 });
  }

  const range = oneYearRange(
    (data.data ?? [])
      .map((item) => ({ date: item.date ?? "", price: Number(item.price) }))
      .filter((item) => item.date && Number.isFinite(item.price))
  );
  if (!range) return NextResponse.json({ error: "no silver observations" }, { status: 502 });

  const row: AssetSnapshotRow = {
    asset_key: "XAG-PERP",
    symbol: "XAG",
    asset_class: "commodity",
    source: "alpha_vantage",
    as_of: new Date().toISOString(),
    market_data: [{ k: "1Y Range", v: range }],
    fields: {},
    source_urls: { alpha_vantage: "https://www.alphavantage.co/documentation/#commodities" },
  };
  const [mergedRow] = await preserveAboutFields(db, [row]);
  const { error } = await db.from("asset_market_snapshots").upsert(mergedRow, { onConflict: "asset_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ upserted: 1, symbols: ["XAG"] }, { headers: jsonHeaders() });
}
