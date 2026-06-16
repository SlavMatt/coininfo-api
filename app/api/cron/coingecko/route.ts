import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Use trending coins (free, no auth) + low-cap markets as proxy for new listings
  const trendingRes = await fetch("https://api.coingecko.com/api/v3/search/trending", {
    headers: { Accept: "application/json" },
  });
  if (!trendingRes.ok) {
    return NextResponse.json({ error: "coingecko error", status: trendingRes.status }, { status: 502 });
  }

  const trendingJson = await trendingRes.json();
  const trendingCoins: any[] = trendingJson?.coins ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const rows = trendingCoins.map((entry: any) => {
    const coin = entry.item ?? entry;
    return {
      id: `coingecko-trending-${coin.id}-${today}`,
      date: today,
      time_utc: null,
      category: "crypto" as const,
      event_type: "trending",
      symbol: coin.symbol?.toUpperCase() ?? null,
      title: `${coin.name ?? coin.symbol} Trending`,
      country: null,
      impact: "low" as const,
      actual: coin.data?.price_change_percentage_24h?.usd != null
        ? String(coin.data.price_change_percentage_24h.usd.toFixed(2))
        : null,
      forecast: null,
      prior: null,
      unit: "%",
      detail: coin.data?.market_cap ?? null,
      source_url: `https://www.coingecko.com/en/coins/${coin.id}`,
      timing: null,
      eps_surprise: null,
      revenue_actual: null,
      revenue_forecast: null,
      exchange: "CoinGecko",
      price_range: coin.data?.price != null ? String(coin.data.price) : null,
      raise_usd: null,
      ipo_status: null,
      underlying: coin.symbol?.toUpperCase() ?? null,
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
