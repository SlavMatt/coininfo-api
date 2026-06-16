import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // CoinGlass ETF net flow — BTC spot ETF daily flows
  const url = "https://open-api-v3.coinglass.com/api/etf/bitcoin/flow-history?exchange=All&type=netflow&limit=7";
  const res = await fetch(url, {
    headers: { "CG-API-KEY": process.env.COINGLASS_API_KEY ?? "" },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "coinglass error", status: res.status }, { status: 502 });
  }

  const json = await res.json();
  const items: any[] = json?.data ?? [];

  const rows = items
    .filter((item) => item.date)
    .map((item) => {
      const dateStr = typeof item.date === "number"
        ? new Date(item.date * 1000).toISOString().slice(0, 10)
        : String(item.date).slice(0, 10);

      const netFlow = item.netFlow ?? item.net_flow ?? null;
      return {
        id: `coinglass-etf-btc-${dateStr}`,
        date: dateStr,
        time_utc: null,
        category: "crypto" as const,
        event_type: "etf_flow",
        symbol: "BTC",
        title: "BTC Spot ETF Net Flow",
        country: "US",
        impact: null,
        actual: netFlow != null ? String(netFlow) : null,
        forecast: null,
        prior: null,
        unit: "USD",
        detail: null,
        source_url: null,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: null,
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying: "BTC",
        oi_usd: null,
        max_pain: null,
        net_flow_usd: netFlow != null ? Number(netFlow) : null,
        source: "coinglass",
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
