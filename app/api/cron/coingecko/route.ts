import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // CoinGecko free API: recently added coins (last 200)
  const url = "https://api.coingecko.com/api/v3/coins/list/new";
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "coingecko error", status: res.status }, { status: 502 });
  }

  const items: any[] = await res.json();
  const today = new Date().toISOString().slice(0, 10);

  const rows = items.slice(0, 50).map((item) => {
    const activatedAt: string | null = item.activated_at
      ? new Date(item.activated_at * 1000).toISOString().slice(0, 10)
      : today;

    return {
      id: `coingecko-listing-${item.id}-${activatedAt}`,
      date: activatedAt,
      time_utc: item.activated_at ? new Date(item.activated_at * 1000).toISOString() : null,
      category: "crypto" as const,
      event_type: "new_listing",
      symbol: item.symbol?.toUpperCase() ?? null,
      title: `${item.name ?? item.symbol} Listed on CoinGecko`,
      country: null,
      impact: "low" as const,
      actual: null,
      forecast: null,
      prior: null,
      unit: null,
      detail: null,
      source_url: `https://www.coingecko.com/en/coins/${item.id}`,
      timing: null,
      eps_surprise: null,
      revenue_actual: null,
      revenue_forecast: null,
      exchange: "CoinGecko",
      price_range: null,
      raise_usd: null,
      ipo_status: null,
      underlying: item.symbol?.toUpperCase() ?? null,
      oi_usd: null,
      max_pain: null,
      net_flow_usd: null,
      source: "coingecko",
    };
  });

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0 });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length });
}
