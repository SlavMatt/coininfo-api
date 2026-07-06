import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logCronFailure } from "@/lib/log";

// EIA series: Weekly Petroleum Status Report
// PET.WCRSTUS1.W = US crude oil stocks (thousand barrels)
const EIA_SERIES = "PET.WCRSTUS1.W";

function thisOrNextWednesday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const daysUntilWed = (3 - day + 7) % 7; // 0 = today is Wednesday
  const wed = new Date(now);
  wed.setUTCDate(now.getUTCDate() + daysUntilWed);
  return wed.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fetch latest 2 data points to get actual + prior
  const url = `https://api.eia.gov/v2/seriesid/${EIA_SERIES}?api_key=${process.env.EIA_API_KEY}&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=2`;
  const res = await fetch(url);
  if (!res.ok) {
    logCronFailure("cron/energy", "EIA error", res.status);
    return NextResponse.json({ error: "EIA error", status: res.status }, { status: 502 });
  }

  const json = await res.json();
  const points: any[] = json?.response?.data ?? [];
  if (points.length === 0) {
    return NextResponse.json({ upserted: 0 });
  }

  const latest = points[0];
  const prior = points[1];
  const releaseDate = thisOrNextWednesday();

  // Store one row per platform crude symbol (CL = WTI, BZ = Brent both driven by same report)
  const baseRow = {
    date: releaseDate,
    time_utc: "14:30:00",
    category: "commodities" as const,
    event_type: "energy",
    title: "EIA Crude Oil Inventories",
    country: "US",
    impact: "high" as const,
    actual: latest.value != null ? String(latest.value) : null,
    forecast: null,
    prior: prior?.value != null ? String(prior.value) : null,
    unit: "K barrels",
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
    underlying: null,
    oi_usd: null,
    max_pain: null,
    net_flow_usd: null,
    source: "eia",
  };

  const rows = [
    { ...baseRow, id: `energy-eia-crude-CL-${latest.period}`, symbol: "CL" },
    { ...baseRow, id: `energy-eia-crude-BZ-${latest.period}`, symbol: "BZ" },
  ];

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) {
    logCronFailure("cron/energy", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: 2, period: latest.period });
}
