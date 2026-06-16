import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PLATFORM_STOCKS = [
  "TSLA","MU","AMD","CRCL","INTC","SNDK",
  "AAPL","AMZN","GOOGL","META","MSTR","MSFT","NVDA","SPCX",
];

const PLATFORM_CRYPTO = [
  "BTC","ETH","SOL","XRP","BNB","ADA","DOGE","LTC","TRX",
  "SUI","HYPE","TRUMP","AXS","AAVE","LINK","PAXG","ZEC",
];

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
    .not("symbol", "in", `(${PLATFORM_STOCKS.map((s) => `"${s}"`).join(",")})`);

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
    .not("symbol", "in", `(${PLATFORM_CRYPTO.map((s) => `"${s}"`).join(",")})`);

  if (e1 || e2 || e3) {
    return NextResponse.json({ errors: [e1?.message, e2?.message, e3?.message].filter(Boolean) }, { status: 500 });
  }

  return NextResponse.json({ deleted: { nonPlatformEarnings: c1, trendingEvents: c2, nonPlatformCrypto: c3 } });
}
