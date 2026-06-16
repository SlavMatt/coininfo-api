import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/admin/backfill-ipo
// Backfills 1 year of Finnhub IPO calendar
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 503 });

  const today = new Date();
  const to = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: "finnhub error", status: res.status }, { status: 502 });

  const data = await res.json();
  const items: any[] = data.ipoCalendar ?? [];

  const rows = items
    .filter((item) => item.date && item.symbol)
    .map((item) => ({
      id: `ipo-${item.symbol}-${item.date}`,
      date: item.date,
      time_utc: null,
      category: "ipo" as const,
      event_type: "ipo",
      symbol: item.symbol,
      title: item.name ?? item.symbol,
      country: "US",
      impact: null,
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
      exchange: item.exchange ?? null,
      price_range: item.price ?? null,
      raise_usd: item.totalSharesValue != null ? Number(item.totalSharesValue) : null,
      ipo_status: item.status ?? null,
      underlying: null,
      oi_usd: null,
      max_pain: null,
      net_flow_usd: null,
      source: "finnhub",
    }));

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, range: { from, to } });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, range: { from, to } });
}
