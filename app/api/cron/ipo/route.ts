import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function getMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { from, to } = getMonthRange();
  const url = `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: "finnhub error", status: res.status }, { status: 502 });
  }

  const data = await res.json();
  const items: unknown[] = data.ipoCalendar ?? [];

  const rows = items
    .filter((item: any) => item.date && item.symbol)
    .map((item: any) => ({
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
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, range: { from, to } });
}
