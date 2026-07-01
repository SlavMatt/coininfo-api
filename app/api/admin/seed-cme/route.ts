import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logCronFailure } from "@/lib/log";

// CME Gold (GC) & Silver (SI) standard monthly options
// Expiry: last Friday of the month prior to the delivery month
// Source: https://www.cmegroup.com/trading/metals/precious/gold_product_calendar_options.html
// Update this list annually when CME publishes the next year's calendar.
const CME_EXPIRY_DATES = [
  // 2026
  { date: "2026-07-31", delivery: "Aug 2026" },
  { date: "2026-08-28", delivery: "Sep 2026" },
  { date: "2026-09-25", delivery: "Oct 2026" },
  { date: "2026-10-30", delivery: "Nov 2026" },
  { date: "2026-11-27", delivery: "Dec 2026" },
  // 2027
  { date: "2027-01-29", delivery: "Feb 2027" },
  { date: "2027-03-26", delivery: "Apr 2027" },
  { date: "2027-05-28", delivery: "Jun 2027" },
  { date: "2027-07-30", delivery: "Aug 2027" },
  { date: "2027-09-24", delivery: "Oct 2027" },
  { date: "2027-11-26", delivery: "Dec 2027" },
];

const METALS = [
  { symbol: "XAU", title: "CME Gold Options Expiry",   source_url: "https://www.cmegroup.com/trading/metals/precious/gold_product_calendar_options.html" },
  { symbol: "XAG", title: "CME Silver Options Expiry", source_url: "https://www.cmegroup.com/trading/metals/precious/silver_product_calendar_options.html" },
];

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows: unknown[] = [];

  for (const { date, delivery } of CME_EXPIRY_DATES) {
    for (const metal of METALS) {
      rows.push({
        id: `cme-options-${metal.symbol}-${date}`,
        date,
        time_utc: "19:00:00", // CME settlement ~15:00 ET = 19:00 UTC
        category: "commodities" as const,
        event_type: "options_expiry",
        symbol: metal.symbol,
        title: metal.title,
        country: "US",
        impact: "high" as const,
        actual: null,
        forecast: null,
        prior: null,
        unit: null,
        detail: `${metal.symbol === "XAU" ? "Gold" : "Silver"} options for ${delivery} delivery settle on this date. Large open interest at key strike prices can create pin risk and sharp intraday moves.`,
        source_url: metal.source_url,
        timing: null,
        eps_surprise: null,
        revenue_actual: null,
        revenue_forecast: null,
        exchange: "CME",
        price_range: null,
        raise_usd: null,
        ipo_status: null,
        underlying: metal.symbol,
        oi_usd: null,
        max_pain: null,
        net_flow_usd: null,
        source: "cme-static",
      });
    }
  }

  const { error } = await db.from("calendar_events").upsert(rows as never[], { onConflict: "id" });
  if (error) {
    logCronFailure("admin/seed-cme", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, dates: CME_EXPIRY_DATES.map((d) => d.date) });
}
