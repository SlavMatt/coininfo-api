import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function getWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(mon), to: fmt(sun) };
}

function impactLevel(impact: string | undefined): "high" | "med" | "low" | null {
  if (!impact) return null;
  const v = impact.toLowerCase();
  if (v === "high" || v === "3") return "high";
  if (v === "medium" || v === "med" || v === "2") return "med";
  if (v === "low" || v === "1") return "low";
  return null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { from, to } = getWeekRange();
  const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: "finnhub error", status: res.status }, { status: 502 });
  }

  const data = await res.json();
  const items: unknown[] = data.economicCalendar ?? [];

  const rows = items
    .filter((item: any) => item.time && item.event)
    .map((item: any) => {
      const dateStr = item.time.slice(0, 10);
      return {
        id: `macro-${item.country ?? "XX"}-${item.event?.replace(/\s+/g, "-")}-${item.time}`,
        date: dateStr,
        time_utc: item.time ? String(item.time).slice(11, 19) || null : null,
        category: "commodities" as const,
        event_type: "macro",
        symbol: null,
        title: item.event,
        country: item.country ?? null,
        impact: impactLevel(item.impact),
        actual: item.actual != null ? String(item.actual) : null,
        forecast: item.estimate != null ? String(item.estimate) : null,
        prior: item.prev != null ? String(item.prev) : null,
        unit: item.unit ?? null,
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
        source: "finnhub",
      };
    });

  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, range: { from, to } });
  }

  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, range: { from, to } });
}
