import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Platform Korean stocks: Yahoo Finance ticker → internal symbol
const KR_STOCKS = [
  { yf: "000660.KS", symbol: "SKHYNIX", name: "SK Hynix",             country: "KR" },
  { yf: "005930.KS", symbol: "SAMSUNG", name: "Samsung Electronics",  country: "KR" },
];

interface YFEarnings {
  date: string;
  forecast: string | null;
  forecastHigh: string | null;
  forecastLow: string | null;
  revenueForecast: string | null;
}

async function fetchYFCalendar(yfSymbol: string): Promise<YFEarnings[]> {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yfSymbol)}?modules=calendarEvents`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const cal = json?.quoteSummary?.result?.[0]?.calendarEvents;
    if (!cal?.earnings?.earningsDate?.length) return [];

    return cal.earnings.earningsDate.map((d: { fmt?: string }) => ({
      date: d.fmt ?? "",
      forecast: cal.earnings.earningsAverage?.raw != null
        ? String(cal.earnings.earningsAverage.raw)
        : null,
      forecastHigh: cal.earnings.earningsHigh?.raw != null
        ? String(cal.earnings.earningsHigh.raw)
        : null,
      forecastLow: cal.earnings.earningsLow?.raw != null
        ? String(cal.earnings.earningsLow.raw)
        : null,
      revenueForecast: cal.earnings.revenueAverage?.raw != null
        ? String(cal.earnings.revenueAverage.raw)
        : null,
    })).filter((e: YFEarnings) => e.date && e.date.length === 10);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows: unknown[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const stock of KR_STOCKS) {
    const earnings = await fetchYFCalendar(stock.yf);

    for (const e of earnings) {
      if (e.date < today.slice(0, 7) + "-01") continue; // skip if before this month
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
        forecast: e.forecast,
        prior: null,
        unit: "KRW",
        detail: e.revenueForecast
          ? `${stock.name} quarterly earnings. Consensus EPS: ${e.forecast ?? "TBD"} KRW. Revenue est.: ${e.revenueForecast} KRW.`
          : `${stock.name} quarterly earnings. Consensus EPS: ${e.forecast ?? "TBD"} KRW/share.`,
        source_url: `https://finance.yahoo.com/quote/${encodeURIComponent(stock.yf)}/financials/`,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: e.revenueForecast,
        exchange: "KRX",
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying: null,
        oi_usd: null,
        max_pain: null,
        net_flow_usd: null,
        source: "yahoo-finance",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, note: "no KR earnings dates from Yahoo Finance" });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r: any) => r.symbol) });
}
