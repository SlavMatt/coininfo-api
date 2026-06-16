import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  FRED_RELEASES,
  FRED_SERIES,
  fetchReleaseDates,
  fetchObservations,
  matchObservation,
  buildMacroRow,
} from "@/app/api/cron/macro/route";

// POST /api/admin/backfill-macro
// Backfills 1 year of FRED macro release history with actuals
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "FRED_API_KEY not set" }, { status: 503 });

  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
  // obs fetch goes 3 months further back to cover prior readings
  const obsFrom = new Date(today.getTime() - 455 * 86400000).toISOString().slice(0, 10);

  const rows: unknown[] = [];
  const summary: Record<string, number> = {};

  for (const r of FRED_RELEASES) {
    const [dates, obs] = await Promise.all([
      fetchReleaseDates(r.id, apiKey, from, to),
      fetchObservations(FRED_SERIES[r.symbol], apiKey, obsFrom, to),
    ]);

    for (const date of dates) {
      const actual = matchObservation(date, obs);
      rows.push(buildMacroRow(r, date, actual));
    }
    summary[r.symbol] = dates.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, summary });
  }

  const { error } = await db.from("calendar_events").upsert(rows as any[], { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: rows.length, summary, range: { from, to } });
}
