import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/events?date=2025-06-16&category=stock
// GET /api/events?from=2025-06-16&to=2025-06-22&category=stock&limit=200
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const category = searchParams.get("category");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);

  let query = db
    .from("calendar_events")
    .select("*")
    .order("date", { ascending: true })
    .order("time_utc", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true })
    .limit(limit);

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    query = query.eq("date", date);
  } else if (from && to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
    }
    query = query.gte("date", from).lte("date", to);
  } else {
    return NextResponse.json({ error: "date or from+to required" }, { status: 400 });
  }

  // Normalise category aliases sent by the frontend
  const categoryMap: Record<string, string> = { stocks: "stock" };
  const resolvedCategory = category ? (categoryMap[category] ?? category) : null;
  if (resolvedCategory) query = query.eq("category", resolvedCategory);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { count: data.length, events: data },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
