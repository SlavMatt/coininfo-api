import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const maxDuration = 60;

// Platform US stocks only
const DIVIDEND_SYMBOLS = [
  "TSLA", "MU", "AMD", "CRCL", "INTC", "SNDK",
  "AAPL", "AMZN", "GOOGL", "META", "MSTR", "MSFT", "NVDA", "SPCX",
  "ARM", "WDC",
];

function getMonthRange(): { from: string; to: string } {
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

  const { from, to } = getMonthRange();
  const rows: unknown[] = [];

  for (const symbol of DIVIDEND_SYMBOLS) {
    const url = `https://finnhub.io/api/v1/stock/dividend2?symbol=${symbol}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    const items: unknown[] = data.data ?? [];
    for (const item of items as any[]) {
      if (!item.exDate) continue;
      rows.push({
        id: `dividends-${symbol}-${item.exDate}`,
        date: item.exDate,
        time_utc: null,
        category: "stock" as const,
        event_type: "dividends",
        symbol,
        title: `${symbol} Dividend`,
        country: "US",
        impact: null,
        actual: item.amount != null ? String(item.amount) : null,
        forecast: null,
        prior: item.prevDiv != null ? String(item.prevDiv) : null,
        unit: "USD",
        detail: item.payDate ? `Pay date: ${item.payDate}` : null,
        source_url: null,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: null,
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying: null,
        oi_usd: null,
        max_pain: null,
        net_flow_usd: null,
        source: "finnhub",
      });
    }
    await new Promise((r) => setTimeout(r, 1100));
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, range: { from, to } });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, range: { from, to } });
}
