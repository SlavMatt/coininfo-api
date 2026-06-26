import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const maxDuration = 60;

// Platform Korean stocks: Finnhub symbol → internal symbol
const KR_STOCKS = [
  { finnhub: "000660.KS", symbol: "SKHYNIX", name: "SK Hynix",            country: "KR" },
  { finnhub: "005930.KS", symbol: "SAMSUNG", name: "Samsung Electronics", country: "KR" },
];

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FINNHUB_API_KEY not configured", upserted: 0 }, { status: 503 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const rows: unknown[] = [];

  for (const stock of KR_STOCKS) {
    try {
      const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${to}&symbol=${encodeURIComponent(stock.finnhub)}&token=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) { await new Promise((r) => setTimeout(r, 1000)); continue; }

      const data = await res.json();
      const items: any[] = data.earningsCalendar ?? [];

      for (const item of items) {
        if (!item.date) continue;
        rows.push({
          id: `kr-earnings-${stock.symbol}-${item.date}`,
          date: item.date,
          time_utc: null,
          category: "stock" as const,
          event_type: "earnings",
          symbol: stock.symbol,
          title: stock.name,
          country: stock.country,
          impact: "high" as const,
          actual: item.eps != null ? String(item.eps) : null,
          forecast: item.epsEstimate != null ? String(item.epsEstimate) : null,
          prior: item.epsPrior != null ? String(item.epsPrior) : null,
          unit: "KRW",
          detail: null,
          source_url: `https://finance.yahoo.com/quote/${encodeURIComponent(stock.finnhub)}/financials/`,
          timing: (item.hour === "bmo" ? "bmo" : item.hour === "amc" ? "amc" : null) as "bmo" | "amc" | null,
          eps_surprise:
            item.eps != null && item.epsEstimate != null
              ? parseFloat((item.eps - item.epsEstimate).toFixed(4))
              : null,
          revenue_actual: item.revenueActual != null ? String(item.revenueActual) : null,
          revenue_forecast: item.revenueEstimate != null ? String(item.revenueEstimate) : null,
          exchange: "KRX",
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
    } catch {
      // continue to next stock
    }
    await new Promise((r) => setTimeout(r, 1100)); // Finnhub free: 60 req/min
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, note: "no upcoming KR earnings dates" });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r: any) => r.symbol) });
}
