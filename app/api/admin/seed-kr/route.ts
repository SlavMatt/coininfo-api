import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logCronFailure } from "@/lib/log";

// Hardcoded upcoming KR earnings dates (update annually from company IR sites)
// Samsung: ir.samsung.com   SK Hynix: investor.skhynix.com
const KR_SEED_ROWS = [
  // Samsung Q2 2026 preliminary (typically first week of July)
  {
    id: "kr-earnings-SAMSUNG-2026-07-07",
    date: "2026-07-07",
    symbol: "SAMSUNG",
    title: "Samsung Electronics",
    detail: "Samsung Electronics Q2 2026 preliminary earnings (잠정실적). Confirmed or estimated date.",
  },
  // SK Hynix Q2 2026 full results (typically late July)
  {
    id: "kr-earnings-SKHYNIX-2026-07-23",
    date: "2026-07-23",
    symbol: "SKHYNIX",
    title: "SK Hynix",
    detail: "SK Hynix Q2 2026 earnings release. Estimated date based on prior year schedule.",
  },
  // Samsung Q2 2026 full results (typically end of July)
  {
    id: "kr-earnings-SAMSUNG-2026-07-30",
    date: "2026-07-30",
    symbol: "SAMSUNG",
    title: "Samsung Electronics",
    detail: "Samsung Electronics Q2 2026 full earnings release (컨퍼런스콜). Estimated date.",
  },
  // Samsung Q3 2026 preliminary (typically first week of October)
  {
    id: "kr-earnings-SAMSUNG-2026-10-07",
    date: "2026-10-07",
    symbol: "SAMSUNG",
    title: "Samsung Electronics",
    detail: "Samsung Electronics Q3 2026 preliminary earnings (잠정실적). Estimated date.",
  },
  // SK Hynix Q3 2026 (typically late October)
  {
    id: "kr-earnings-SKHYNIX-2026-10-22",
    date: "2026-10-22",
    symbol: "SKHYNIX",
    title: "SK Hynix",
    detail: "SK Hynix Q3 2026 earnings release. Estimated date based on prior year schedule.",
  },
].map((r) => ({
  ...r,
  time_utc: null,
  category: "stock" as const,
  event_type: "earnings",
  country: "KR",
  impact: "high" as const,
  actual: null,
  forecast: null,
  prior: null,
  unit: "KRW",
  source_url: null,
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
  source: "manual-seed",
}));

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { error } = await db
    .from("calendar_events")
    .upsert(KR_SEED_ROWS, { onConflict: "id" });

  if (error) {
    logCronFailure("admin/seed-kr", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    seeded: KR_SEED_ROWS.length,
    rows: KR_SEED_ROWS.map((r) => ({ id: r.id, date: r.date, symbol: r.symbol })),
    note: "Estimated dates — update when companies confirm via IR sites",
  });
}
