import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonHeaders } from "@/lib/asset-market";

// GET /api/assets?symbols=BTC-PERP,TSLA-PERP
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbols = searchParams
    .get("symbols")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let query = db
    .from("asset_market_snapshots")
    .select("asset_key,symbol,asset_class,source,market_data,fields,source_urls,as_of")
    .order("asset_key", { ascending: true });

  if (symbols?.length) {
    query = query.in("asset_key", symbols.slice(0, 100));
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const assets = Object.fromEntries((data ?? []).map((row) => [row.asset_key, row]));
  return NextResponse.json(
    { count: data?.length ?? 0, assets },
    { headers: jsonHeaders("public, s-maxage=600, stale-while-revalidate=3600") }
  );
}
