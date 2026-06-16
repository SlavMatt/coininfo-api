import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PLATFORM_STOCKS = new Set([
  "TSLA", "MU", "AMD", "CRCL", "INTC", "SNDK",
  "AAPL", "AMZN", "GOOGL", "META", "MSTR", "MSFT", "NVDA", "SPCX",
]);

// POST /api/admin/backfill-stock
// Backfills 1 year of Finnhub earnings calendar for platform stocks
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 503 });

  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: "finnhub error", status: res.status }, { status: 502 });

  const data = await res.json();
  const items: any[] = data.earningsCalendar ?? [];

  const rows = items
    .filter((item) => item.date && item.symbol && PLATFORM_STOCKS.has(item.symbol))
    .map((item) => ({
      id: `stock-earnings-${item.symbol}-${item.date}`,
      date: item.date,
      time_utc: null,
      category: "stock" as const,
      event_type: "earnings",
      symbol: item.symbol,
      title: item.name ?? item.symbol,
      country: "US",
      impact: null,
      actual: item.eps != null ? String(item.eps) : null,
      forecast: item.epsEstimate != null ? String(item.epsEstimate) : null,
      prior: item.epsPrior != null ? String(item.epsPrior) : null,
      unit: "USD",
      detail: null,
      source_url: null,
      timing: (item.hour === "bmo" ? "bmo" : item.hour === "amc" ? "amc" : null) as "bmo" | "amc" | null,
      eps_surprise: item.eps != null && item.epsEstimate != null
        ? parseFloat((item.eps - item.epsEstimate).toFixed(4))
        : null,
      revenue_actual: item.revenueActual != null ? String(item.revenueActual) : null,
      revenue_forecast: item.revenueEstimate != null ? String(item.revenueEstimate) : null,
      exchange: null,
      price_range: null,
      raise_usd: null,
      ipo_status: null,
      underlying: null,
      oi_usd: null,
      max_pain: null,
      net_flow_usd: null,
      source: "finnhub",
    }));

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, note: "no platform stock earnings found", range: { from, to } });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bySymbol: Record<string, number> = {};
  rows.forEach((r: any) => { bySymbol[r.symbol] = (bySymbol[r.symbol] ?? 0) + 1; });

  return NextResponse.json({ upserted: rows.length, bySymbol, range: { from, to } });
}
