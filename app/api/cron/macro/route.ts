import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Key FRED releases that move commodities / metals / USD
const FRED_RELEASES = [
  { id: 46,  symbol: "CPI",  title: "CPI — Consumer Price Index",       impact: "high" as const, time_utc: "13:30:00" },
  { id: 167, symbol: "PPI",  title: "PPI — Producer Price Index",       impact: "med"  as const, time_utc: "13:30:00" },
  { id: 10,  symbol: "NFP",  title: "NFP — Non-Farm Payrolls",          impact: "high" as const, time_utc: "13:30:00" },
  { id: 175, symbol: "PCE",  title: "PCE — Personal Income & Outlays",  impact: "high" as const, time_utc: "13:30:00" },
  { id: 96,  symbol: "FOMC", title: "FOMC — Interest Rate Decision",    impact: "high" as const, time_utc: "19:00:00" },
];

// FRED series IDs to pull latest actual readings
const FRED_SERIES: Record<string, string> = {
  CPI:  "CPIAUCSL",  // CPI Urban Consumers, monthly
  PPI:  "PPIACO",    // PPI All Commodities, monthly
  NFP:  "PAYEMS",    // Non-farm payrolls, monthly
  PCE:  "DPCERD3M086SBEA", // PCE price index, monthly
  FOMC: "DFEDTARU",  // Fed Funds Target Upper Rate (changes on FOMC dates)
};

async function fetchReleaseDates(releaseId: number, apiKey: string, from: string, to: string): Promise<string[]> {
  const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&sort_order=asc&include_release_dates_with_no_data=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return ((json?.release_dates ?? []) as { date: string }[])
      .map((d) => d.date)
      .filter((d) => d >= from && d <= to);
  } catch {
    return [];
  }
}

async function fetchLatestObservation(seriesId: string, apiKey: string): Promise<{ date: string; value: string } | null> {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=2`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const obs = (json?.observations ?? []) as { date: string; value: string }[];
    // first entry might be "." (no data yet for current month), take first real value
    const real = obs.find((o) => o.value !== ".");
    return real ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FRED_API_KEY not configured", upserted: 0 }, { status: 503 });
  }

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  const rows: unknown[] = [];

  for (const r of FRED_RELEASES) {
    // 1. Upcoming scheduled dates
    const dates = await fetchReleaseDates(r.id, apiKey, from, to);

    // 2. Latest actual reading (to back-fill actuals on recent dates)
    const latest = await fetchLatestObservation(FRED_SERIES[r.symbol], apiKey);

    // Upsert upcoming events (actual=null, will be filled on next run after release)
    for (const date of dates) {
      const isLatestDate = latest?.date === date;
      rows.push({
        id: `fred-macro-${r.symbol}-${date}`,
        date,
        time_utc: r.time_utc,
        category: "commodities" as const,
        event_type: "macro",
        symbol: r.symbol,
        title: r.title,
        country: "US",
        impact: r.impact,
        actual: isLatestDate ? latest!.value : null,
        forecast: null,
        prior: null,
        unit: null,
        detail: null,
        source_url: `https://fred.stlouisfed.org/release?release_id=${r.id}`,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: "FRED",
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying: null,
        oi_usd: null,
        max_pain: null,
        net_flow_usd: null,
        source: "fred",
      });
    }

    // If latest observation is in the past (not in upcoming), still add it so the tab shows data
    if (latest && !dates.includes(latest.date) && latest.date >= from.slice(0, 7) + "-01") {
      rows.push({
        id: `fred-macro-${r.symbol}-${latest.date}`,
        date: latest.date,
        time_utc: r.time_utc,
        category: "commodities" as const,
        event_type: "macro",
        symbol: r.symbol,
        title: r.title,
        country: "US",
        impact: r.impact,
        actual: latest.value,
        forecast: null,
        prior: null,
        unit: null,
        detail: null,
        source_url: `https://fred.stlouisfed.org/release?release_id=${r.id}`,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: "FRED",
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying: null,
        oi_usd: null,
        max_pain: null,
        net_flow_usd: null,
        source: "fred",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, note: "no macro dates returned by FRED" });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, releases: FRED_RELEASES.map((r) => r.symbol) });
}
