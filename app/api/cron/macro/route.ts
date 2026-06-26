import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const FRED_RELEASES = [
  { id: 46,  symbol: "CPI",    title: "CPI — Consumer Price Index",             impact: "high" as const, time_utc: "13:30:00" },
  { id: 167, symbol: "PPI",    title: "PPI — Producer Price Index",             impact: "med"  as const, time_utc: "13:30:00" },
  { id: 10,  symbol: "NFP",    title: "NFP — Non-Farm Payrolls",                impact: "high" as const, time_utc: "13:30:00" },
  { id: 175, symbol: "PCE",    title: "PCE — Personal Consumption Expenditures",impact: "high" as const, time_utc: "13:30:00" },
  { id: 96,  symbol: "FOMC",   title: "FOMC — Interest Rate Decision",          impact: "high" as const, time_utc: "19:00:00" },
  { id: 53,  symbol: "GDP",    title: "GDP — Gross Domestic Product",           impact: "high" as const, time_utc: "13:30:00" },
  { id: 9,   symbol: "RSALES", title: "Retail Sales",                           impact: "high" as const, time_utc: "13:30:00" },
  { id: 180, symbol: "IJC",    title: "Initial Jobless Claims",                 impact: "med"  as const, time_utc: "13:30:00" },
  { id: 27,  symbol: "HOUST",  title: "Housing Starts",                         impact: "med"  as const, time_utc: "13:30:00" },
  { id: 91,  symbol: "UMCS",   title: "Consumer Sentiment (Univ. Michigan)",    impact: "med"  as const, time_utc: "15:00:00" },
  { id: 95,  symbol: "DURABLE",title: "Durable Goods Orders",                   impact: "med"  as const, time_utc: "13:30:00" },
];

export const FRED_SERIES: Record<string, string> = {
  CPI:    "CPIAUCSL",
  PPI:    "PPIACO",
  NFP:    "PAYEMS",
  PCE:    "DPCERD3M086SBEA",
  FOMC:   "DFEDTARU",
  GDP:    "GDP",
  RSALES: "RSAFS",
  IJC:    "ICSA",
  HOUST:  "HOUST",
  UMCS:   "UMCSENT",
  DURABLE:"DGORDER",
};

export async function fetchReleaseDates(releaseId: number, apiKey: string, from: string, to: string): Promise<string[]> {
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

export async function fetchObservations(seriesId: string, apiKey: string, from: string, to: string): Promise<{ date: string; value: string }[]> {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=asc&observation_start=${from}&observation_end=${to}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return ((json?.observations ?? []) as { date: string; value: string }[])
      .filter((o) => o.value !== ".");
  } catch {
    return [];
  }
}

// Find the most recent observation before or on a given release date
export function matchObservation(relDate: string, obs: { date: string; value: string }[]): string | null {
  const candidates = obs.filter((o) => o.date <= relDate);
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1].value;
}

// Find the second most recent observation — used as "prior period" for past releases
function matchPriorObservation(relDate: string, obs: { date: string; value: string }[]): string | null {
  const candidates = obs.filter((o) => o.date <= relDate);
  if (candidates.length < 2) return null;
  return candidates[candidates.length - 2].value;
}

const FRED_SOURCE_URLS: Record<string, string> = {
  CPI:    "https://fred.stlouisfed.org/series/CPIAUCSL",
  PPI:    "https://fred.stlouisfed.org/series/PPIACO",
  NFP:    "https://fred.stlouisfed.org/series/PAYEMS",
  PCE:    "https://fred.stlouisfed.org/series/DPCERD3M086SBEA",
  FOMC:   "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  GDP:    "https://fred.stlouisfed.org/series/GDP",
  RSALES: "https://fred.stlouisfed.org/series/RSAFS",
  IJC:    "https://fred.stlouisfed.org/series/ICSA",
  HOUST:  "https://fred.stlouisfed.org/series/HOUST",
  UMCS:   "https://fred.stlouisfed.org/series/UMCSENT",
  DURABLE:"https://fred.stlouisfed.org/series/DGORDER",
};

export function buildMacroRow(
  r: typeof FRED_RELEASES[0],
  date: string,
  actual: string | null,
  prior: string | null = null,
): Record<string, unknown> {
  return {
    id: `fred-macro-${r.symbol}-${date}`,
    date,
    time_utc: r.time_utc,
    category: "economic" as const,
    event_type: "macro",
    symbol: r.symbol,
    title: r.title,
    country: "US",
    impact: r.impact,
    actual,
    forecast: null,
    prior,
    unit: null,
    detail: null,
    source_url: FRED_SOURCE_URLS[r.symbol] ?? null,
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
  };
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
  const todayStr = today.toISOString().slice(0, 10);
  const from = todayStr;
  const to = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  // obs lookback: 6 months to capture enough history for prior period values
  const obsFrom = new Date(today.getTime() - 180 * 86400000).toISOString().slice(0, 10);

  const rows: unknown[] = [];

  for (const r of FRED_RELEASES) {
    const [dates, obs] = await Promise.all([
      fetchReleaseDates(r.id, apiKey, from, to),
      fetchObservations(FRED_SERIES[r.symbol], apiKey, obsFrom, to),
    ]);

    for (const date of dates) {
      const isFuture = date > todayStr;
      if (isFuture) {
        // Future: matched value = last known (prior), actual not yet available
        const prior = matchObservation(date, obs);
        rows.push(buildMacroRow(r, date, null, prior));
      } else {
        // Past: most recent obs = actual, second most recent = prior period
        const actual = matchObservation(date, obs);
        const prior = matchPriorObservation(date, obs);
        rows.push(buildMacroRow(r, date, actual, prior));
      }
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
