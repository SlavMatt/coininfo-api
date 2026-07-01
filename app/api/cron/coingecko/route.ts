import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PLATFORM_CRYPTO_MAP as PLATFORM_CRYPTO } from "@/lib/constants";
import { logCronFailure } from "@/lib/log";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ids = Object.keys(PLATFORM_CRYPTO).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    logCronFailure("cron/coingecko", "coingecko error", res.status);
    return NextResponse.json({ error: "coingecko error", status: res.status }, { status: 502 });
  }

  const items: any[] = await res.json();
  const today = new Date().toISOString().slice(0, 10);

  const rows = items
    .filter((item) => PLATFORM_CRYPTO[item.id])
    .map((item) => {
      const symbol = PLATFORM_CRYPTO[item.id];
      const pct24h = item.price_change_percentage_24h;
      const price = item.current_price;

      return {
        id: `coingecko-platform-${symbol}-${today}`,
        date: today,
        time_utc: null,
        category: "crypto" as const,
        event_type: "price_update",
        symbol,
        title: `${item.name ?? symbol}`,
        country: null,
        impact: null,
        actual: pct24h != null ? pct24h.toFixed(2) : null,
        forecast: null,
        prior: null,
        unit: "%",
        detail: null,
        source_url: `https://www.coingecko.com/en/coins/${item.id}`,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: "CoinGecko",
        price_range: price != null ? String(price) : null,
        raise_usd: null,
        ipo_status: null,
        underlying: symbol,
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
    logCronFailure("cron/coingecko", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r) => r.symbol) });
}
