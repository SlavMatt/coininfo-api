import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const UNDERLYINGS = ["BTC", "ETH"];

async function fetchExpiries(underlying: string): Promise<any[]> {
  const url = `https://www.deribit.com/api/v2/public/get_instruments?currency=${underlying}&kind=option&expired=false`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  const instruments: any[] = json?.result ?? [];

  // Group by expiry date and sum OI
  const byExpiry = new Map<string, { oi_usd: number; count: number }>();
  for (const inst of instruments) {
    const exp = inst.expiration_timestamp;
    if (!exp) continue;
    const date = new Date(exp).toISOString().slice(0, 10);
    const existing = byExpiry.get(date) ?? { oi_usd: 0, count: 0 };
    existing.count++;
    byExpiry.set(date, existing);
  }

  return Array.from(byExpiry.entries()).map(([date, val]) => ({ date, ...val }));
}

async function fetchOpenInterest(underlying: string): Promise<Map<string, number>> {
  // Deribit aggregate OI per currency
  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${underlying}&kind=option`;
  const res = await fetch(url);
  if (!res.ok) return new Map();
  const json = await res.json();
  const items: any[] = json?.result ?? [];

  const oiByDate = new Map<string, number>();
  for (const item of items) {
    if (!item.instrument_name || item.open_interest == null) continue;
    // instrument_name: BTC-27JUN25-100000-C → parse expiry
    const parts = item.instrument_name.split("-");
    if (parts.length < 2) continue;
    const expStr = parts[1]; // e.g. "27JUN25"
    const months: Record<string, string> = {
      JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
      JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12",
    };
    const day = expStr.slice(0, 2);
    const mon = months[expStr.slice(2, 5)];
    const yr = "20" + expStr.slice(5, 7);
    if (!mon) continue;
    const date = `${yr}-${mon}-${day}`;
    oiByDate.set(date, (oiByDate.get(date) ?? 0) + item.open_interest);
  }
  return oiByDate;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows: unknown[] = [];

  for (const underlying of UNDERLYINGS) {
    const expiries = await fetchExpiries(underlying);
    const oiMap = await fetchOpenInterest(underlying);

    for (const { date } of expiries) {
      const oiUsd = oiMap.get(date) ?? null;
      rows.push({
        id: `deribit-options-${underlying}-${date}`,
        date,
        time_utc: `${date}T08:00:00Z`,
        category: "crypto" as const,
        event_type: "options_expiry",
        symbol: underlying,
        title: `${underlying} Options Expiry`,
        country: null,
        impact: oiUsd != null && oiUsd > 1_000_000_000 ? "high" as const : "med" as const,
        actual: null,
        forecast: null,
        prior: null,
        unit: null,
        detail: null,
        source_url: null,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: "Deribit",
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying,
        oi_usd: oiUsd,
        max_pain: null,
        net_flow_usd: null,
        source: "deribit",
      });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0 });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length });
}
