import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Platform Korean stocks: Alpha Vantage symbol → internal symbol
const KR_STOCKS = [
  { av: "000660.KS", symbol: "SKHYNIX", name: "SK Hynix",            country: "KR" },
  { av: "005930.KS", symbol: "SAMSUNG", name: "Samsung Electronics", country: "KR" },
];

// Parse Alpha Vantage EARNINGS_CALENDAR CSV response
function parseEarningsCSV(csv: string): { date: string; estimate: string | null }[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  // header: symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay
  return lines.slice(1).flatMap((line) => {
    const cols = line.split(",");
    if (cols.length < 5) return [];
    const date = cols[2]?.trim();
    const estimate = cols[4]?.trim() || null;
    if (!date || date.length !== 10) return [];
    return [{ date, estimate: estimate === "None" || estimate === "" ? null : estimate }];
  });
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ALPHA_VANTAGE_KEY not configured", upserted: 0 }, { status: 503 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows: unknown[] = [];

  for (const stock of KR_STOCKS) {
    try {
      const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&symbol=${encodeURIComponent(stock.av)}&horizon=3month&apikey=${apiKey}`;
      const res = await fetch(url, { headers: { Accept: "text/csv" } });
      if (!res.ok) { await new Promise((r) => setTimeout(r, 1000)); continue; }

      const csv = await res.text();
      const entries = parseEarningsCSV(csv).filter((e) => e.date >= today);

      for (const e of entries) {
        rows.push({
          id: `kr-earnings-${stock.symbol}-${e.date}`,
          date: e.date,
          time_utc: null,
          category: "stock" as const,
          event_type: "earnings",
          symbol: stock.symbol,
          title: stock.name,
          country: stock.country,
          impact: "high" as const,
          actual: null,
          forecast: e.estimate,
          prior: null,
          unit: "KRW",
          detail: `${stock.name} quarterly earnings. EPS consensus: ${e.estimate ?? "TBD"} KRW.`,
          source_url: `https://finance.yahoo.com/quote/${encodeURIComponent(stock.av)}/financials/`,
          timing: null,
          eps_surprise: null,
          revenue_actual: null,
          revenue_forecast: null,
          exchange: "KRX",
          price_range: null,
          raise_usd: null,
          ipo_status: null,
          underlying: null,
          oi_usd: null,
          max_pain: null,
          net_flow_usd: null,
          source: "alpha-vantage",
        });
      }
    } catch {
      // continue to next stock
    }
    await new Promise((r) => setTimeout(r, 13000)); // Alpha Vantage free: 5 req/min
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, note: "no upcoming KR earnings dates" });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r: any) => r.symbol) });
}
