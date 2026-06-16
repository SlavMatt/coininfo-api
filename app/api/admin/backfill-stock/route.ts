import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PLATFORM_STOCKS = [
  "TSLA", "MU", "AMD", "INTC", "SNDK",
  "AAPL", "AMZN", "GOOGL", "META", "MSTR", "MSFT", "NVDA",
];

// POST /api/admin/backfill-stock
// Uses Finnhub /stock/earnings (historical per-company) + calendar endpoint for upcoming
// Announcement date ≈ period_end + 21 days (approximate for historical records)
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 503 });

  const today = new Date();
  const oneYearAgo = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);

  const rows: any[] = [];
  const bySymbol: Record<string, number> = {};

  // 1. Historical actuals via /stock/earnings (past 8 quarters per stock)
  for (const symbol of PLATFORM_STOCKS) {
    const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}&limit=8&token=${token}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data: any[] = await res.json();
      if (!Array.isArray(data)) continue;

      for (const q of data) {
        if (!q.period) continue;
        // Approximate announcement date: fiscal quarter end + 21 days
        const periodDate = new Date(q.period);
        const annDate = new Date(periodDate.getTime() + 21 * 86400000);
        const date = annDate.toISOString().slice(0, 10);
        if (date < oneYearAgo) continue;

        rows.push({
          id: `stock-earnings-${symbol}-${date}`,
          date,
          time_utc: null,
          category: "stock" as const,
          event_type: "earnings",
          symbol,
          title: symbol,
          country: "US",
          impact: null,
          actual: q.actual != null ? String(q.actual) : null,
          forecast: q.estimate != null ? String(q.estimate) : null,
          prior: null,
          unit: "USD",
          detail: q.period ? `Fiscal period: ${q.period} (Q${q.quarter} ${q.year})` : null,
          source_url: null,
          timing: "amc" as const,
          eps_surprise: q.surprise != null ? parseFloat(q.surprise.toFixed(4)) : null,
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
        bySymbol[symbol] = (bySymbol[symbol] ?? 0) + 1;
      }
    } catch {
      // skip symbol on error
    }
    await new Promise((r) => setTimeout(r, 220)); // free tier: ~5 req/s
  }

  // 2. Upcoming earnings via calendar endpoint (today → +90 days)
  const calFrom = today.toISOString().slice(0, 10);
  const calTo = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const PLAT_SET = new Set(PLATFORM_STOCKS);
  try {
    const calUrl = `https://finnhub.io/api/v1/calendar/earnings?from=${calFrom}&to=${calTo}&token=${token}`;
    const calRes = await fetch(calUrl);
    if (calRes.ok) {
      const calData = await calRes.json();
      const items: any[] = calData.earningsCalendar ?? [];
      for (const item of items) {
        if (!item.date || !item.symbol || !PLAT_SET.has(item.symbol)) continue;
        rows.push({
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
          timing: (item.hour === "bmo" ? "bmo" : "amc") as "bmo" | "amc",
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
        });
      }
    }
  } catch { /* ignore */ }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, note: "no data returned", bySymbol });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, bySymbol, range: { from: oneYearAgo, to: calTo } });
}
