import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PLATFORM_STOCKS as PLATFORM_STOCKS_LIST } from "@/lib/constants";
import { logCronFailure } from "@/lib/log";

const PLATFORM_STOCKS = new Set(PLATFORM_STOCKS_LIST);

function getRange(): { from: string; to: string } {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { from, to } = getRange();
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    logCronFailure("cron/stock", "finnhub error", res.status);
    return NextResponse.json({ error: "finnhub error", status: res.status }, { status: 502 });
  }

  const data = await res.json();
  const items: unknown[] = data.earningsCalendar ?? [];

  const rows = items
    .filter((item: any) => item.date && item.symbol && PLATFORM_STOCKS.has(item.symbol))
    .map((item: any) => ({
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
    return NextResponse.json({ upserted: 0, range: { from, to }, note: "no platform stocks found this week" });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) {
    logCronFailure("cron/stock", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r: any) => r.symbol), range: { from, to } });
}
