import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PLATFORM_STOCKS, PLATFORM_CRYPTO } from "@/lib/constants";
import { logCronFailure } from "@/lib/log";

// DELETE non-platform earnings and trending data, keep options/etf/ipo
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Delete non-platform stock earnings
  const { error: e1, count: c1 } = await db
    .from("calendar_events")
    .delete({ count: "exact" })
    .eq("event_type", "earnings")
    .not("symbol", "in", `(${PLATFORM_STOCKS.join(",")})`);

  // Delete old "trending" events (replaced by "price_update")
  const { error: e2, count: c2 } = await db
    .from("calendar_events")
    .delete({ count: "exact" })
    .eq("event_type", "trending");

  // Delete non-platform crypto price_update events
  const { error: e3, count: c3 } = await db
    .from("calendar_events")
    .delete({ count: "exact" })
    .eq("event_type", "price_update")
    .not("symbol", "in", `(${PLATFORM_CRYPTO.join(",")})`);

  if (e1 || e2 || e3) {
    const errors = [e1?.message, e2?.message, e3?.message].filter(Boolean);
    logCronFailure("admin/cleanup", "supabase delete failed", errors);
    return NextResponse.json({ errors }, { status: 500 });
  }

  return NextResponse.json({ deleted: { nonPlatformEarnings: c1, trendingEvents: c2, nonPlatformCrypto: c3 } });
}
