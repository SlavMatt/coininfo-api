import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PLATFORM_STOCKS = [
  "TSLA", "MU", "AMD", "INTC",
  "AAPL", "AMZN", "GOOGL", "META", "MSTR", "MSFT", "NVDA",
];

// POST /api/admin/backfill-stock
// Uses Alpha Vantage EARNINGS function — returns real reportedDate + historical EPS
// Rate limit: 5 req/min (free tier) → 13s delay between calls
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const avKey = process.env.ALPHA_VANTAGE_KEY;
  if (!avKey) return NextResponse.json({ error: "ALPHA_VANTAGE_KEY not set" }, { status: 503 });

  const today = new Date();
  const oneYearAgo = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
  const ninetyDaysOut = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  const rows: any[] = [];
  const bySymbol: Record<string, number> = {};
  const errors: string[] = [];

  for (const symbol of PLATFORM_STOCKS) {
    const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${symbol}&apikey=${avKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) { errors.push(`${symbol}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      if (data["Note"] || data["Information"]) {
        errors.push(`${symbol}: rate limit`);
        break; // stop processing if rate limited
      }
      const quarters: any[] = data.quarterlyEarnings ?? [];

      for (const q of quarters) {
        const date = q.reportedDate;
        if (!date || date < oneYearAgo || date > ninetyDaysOut) continue;
        const actual = q.reportedEPS !== "None" ? q.reportedEPS : null;
        const forecast = q.estimatedEPS !== "None" ? q.estimatedEPS : null;
        const surprise = q.surprise !== "None" && actual != null && forecast != null
          ? parseFloat(parseFloat(q.surprise).toFixed(4)) : null;

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
          actual,
          forecast,
          prior: null,
          unit: "USD",
          detail: q.fiscalDateEnding ? `Fiscal period ending: ${q.fiscalDateEnding}` : null,
          source_url: null,
          timing: "amc" as const,
          eps_surprise: surprise,
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
          source: "alphavantage",
        });
        bySymbol[symbol] = (bySymbol[symbol] ?? 0) + 1;
      }
    } catch (e: any) {
      errors.push(`${symbol}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 13000)); // 5 req/min free tier
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, bySymbol, errors });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, bySymbol, errors, range: { from: oneYearAgo, to: ninetyDaysOut } });
}
