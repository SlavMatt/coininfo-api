import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AssetSnapshotRow, formatNumber, jsonHeaders } from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

export const maxDuration = 60;

type PricePoint = { date: string; price: number };

function oneYearRange(points: PricePoint[]): string | null {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const recent = points.filter((point) => new Date(point.date) >= cutoff);
  if (!recent.length) return null;

  const values = recent.map((point) => point.price);
  return `$${formatNumber(Math.min(...values), 2)}-$${formatNumber(Math.max(...values), 2)}`;
}

async function fetchFredRange(seriesId: string): Promise<string | null> {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;

  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start.toISOString().slice(0, 10));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);
  const data: { observations?: Array<{ date?: string; value?: string }> } = await res.json();
  const points = (data.observations ?? [])
    .map((item) => ({ date: item.date ?? "", price: Number(item.value) }))
    .filter((item) => item.date && Number.isFinite(item.price));
  return oneYearRange(points);
}

async function fetchMetalRange(symbol: "GOLD" | "SILVER"): Promise<string | null> {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) return null;

  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "GOLD_SILVER_HISTORY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "daily");
  url.searchParams.set("apikey", key);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage ${symbol}: HTTP ${res.status}`);
  const data: { data?: Array<{ date?: string; price?: string }> & unknown; Information?: string; Note?: string } = await res.json();
  if (data.Information || data.Note) throw new Error(`Alpha Vantage ${symbol}: rate limited`);
  const points = (Array.isArray(data.data) ? data.data : [])
    .map((item) => ({ date: item.date ?? "", price: Number(item.price) }))
    .filter((item) => item.date && Number.isFinite(item.price));
  return oneYearRange(points);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const rows: AssetSnapshotRow[] = [];
  const failures: string[] = [];
  const add = (symbol: string, range: string | null, source: string, sourceUrl: string) => {
    if (!range) return;
    rows.push({
      asset_key: `${symbol}-PERP`,
      symbol,
      asset_class: "commodity",
      source,
      as_of: now,
      market_data: [{ k: "1Y Range", v: range }],
      fields: {},
      source_urls: { [source]: sourceUrl },
    });
  };

  const oilTasks = [
    fetchFredRange("DCOILWTICO")
      .then((range) => add("CL", range, "fred", "https://fred.stlouisfed.org/series/DCOILWTICO"))
      .catch((error) => { failures.push(error instanceof Error ? error.message : "WTI range failed"); }),
    fetchFredRange("DCOILBRENTEU")
      .then((range) => add("BZ", range, "fred", "https://fred.stlouisfed.org/series/DCOILBRENTEU"))
      .catch((error) => { failures.push(error instanceof Error ? error.message : "Brent range failed"); }),
  ];
  await Promise.all(oilTasks);

  try {
    const range = await fetchMetalRange("GOLD");
    add("XAU", range, "alpha_vantage", "https://www.alphavantage.co/documentation/#commodities");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Gold range failed");
  }

  if (failures.length) logCronFailure("cron/assets-commodity", `${failures.length} commodity fetch(es) failed`, failures);
  if (rows.length === 0) return NextResponse.json({ upserted: 0, failures }, { status: 502 });

  const { error } = await db.from("asset_market_snapshots").upsert(rows, { onConflict: "asset_key" });
  if (error) {
    logCronFailure("cron/assets-commodity", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((row) => row.symbol), failures }, { headers: jsonHeaders() });
}
