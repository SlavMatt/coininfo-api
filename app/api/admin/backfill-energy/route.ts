import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logCronFailure } from "@/lib/log";

// POST /api/admin/backfill-energy
// Backfills 1 year of EIA weekly crude oil inventory data
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const eiaKey = process.env.EIA_API_KEY;
  if (!eiaKey) return NextResponse.json({ error: "EIA_API_KEY not set" }, { status: 503 });

  const today = new Date();
  const start = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);

  const url = `https://api.eia.gov/v2/seriesid/PET.WCRSTUS1.W?api_key=${eiaKey}&start=${start}&out=json`;
  const res = await fetch(url);
  if (!res.ok) {
    logCronFailure("admin/backfill-energy", "EIA fetch failed", res.status);
    return NextResponse.json({ error: "EIA fetch failed", status: res.status }, { status: 502 });
  }

  const json = await res.json();
  const data: { period: string; value: number }[] = json?.response?.data ?? [];

  if (data.length === 0) return NextResponse.json({ upserted: 0 });

  // Sort ascending so we can compute WoW prior
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));

  const rows = sorted.map((item, i) => {
    const prior = i > 0 ? String(sorted[i - 1].value) : null;
    // EIA period is the week-ending date (Saturday); release is ~Wednesday 2 weeks after
    // Store with period date as the event date for historical display
    return {
      id: `eia-energy-WTI-${item.period}`,
      date: item.period,
      time_utc: "14:30:00",
      category: "commodities" as const,
      event_type: "energy",
      symbol: "WTI",
      title: "EIA Crude Oil Inventories",
      country: "US",
      impact: "high",
      actual: String(item.value),
      forecast: null,
      prior,
      unit: "MBBL",
      detail: null,
      source_url: "https://www.eia.gov/petroleum/supply/weekly/",
      timing: null,
      eps_surprise: null,
      revenue_actual: null,
      revenue_forecast: null,
      exchange: "EIA",
      price_range: null,
      raise_usd: null,
      ipo_status: null,
      underlying: null,
      oi_usd: null,
      max_pain: null,
      net_flow_usd: null,
      source: "eia",
    };
  });

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) {
    logCronFailure("admin/backfill-energy", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, range: { from: start, to: today.toISOString().slice(0, 10) } });
}
