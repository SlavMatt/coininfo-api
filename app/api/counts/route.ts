import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/counts?from=2025-06-16&to=2025-06-20
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Fetch minimal fields for aggregation
  const { data, error } = await db
    .from("calendar_events")
    .select("date, category")
    .gte("date", from)
    .lte("date", to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate counts per date per category in JS
  const result: Record<string, Record<string, number>> = {};
  for (const row of data ?? []) {
    const d = row.date as string;
    const cat = row.category as string;
    if (!d || !cat) continue;
    if (!result[d]) result[d] = { crypto: 0, stock: 0, economic: 0, commodities: 0, ipo: 0 };
    result[d][cat] = (result[d][cat] ?? 0) + 1;
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
