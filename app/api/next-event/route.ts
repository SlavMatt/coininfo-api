import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Asset symbol (without -PERP) → DB categories to search
const ASSET_CATS: Record<string, string[]> = {
  BTC:     ["crypto","economic"],
  ETH:     ["crypto","economic"],
  SOL:     ["crypto","economic"],
  BNB:     ["crypto","economic"],
  DOGE:    ["crypto","economic"],
  XRP:     ["crypto","economic"],
  LTC:     ["crypto","economic"],
  SUI:     ["crypto","economic"],
  HYPE:    ["crypto","economic"],
  STX:     ["crypto","economic"],
  TSLA:    ["stock","economic"],
  NVDA:    ["stock","economic"],
  AMD:     ["stock","economic"],
  AAPL:    ["stock","economic"],
  MSFT:    ["stock","economic"],
  META:    ["stock","economic"],
  AMZN:    ["stock","economic"],
  GOOGL:   ["stock","economic"],
  MU:      ["stock","economic"],
  INTC:    ["stock","economic"],
  MSTR:    ["stock","economic"],
  ARM:     ["stock","economic"],
  WDC:     ["stock","economic"],
  SNDK:    ["stock","economic"],
  SKHYNIX: ["stock","economic"],
  SAMSUNG: ["stock","economic"],
  CRCL:    ["stock","economic"],
  CL:      ["commodities","economic"],
  BZ:      ["commodities","economic"],
  XAU:     ["commodities","economic"],
  XAG:     ["commodities","economic"],
  NDX100:  ["commodities","economic"],
  SP500:   ["commodities","economic"],
  SPCX:    ["commodities","economic"],
};

// Human-readable category label
const CAT_LABEL: Record<string, string> = {
  crypto: "Crypto", stock: "Stocks", economic: "Economic",
  commodities: "Commodities", ipo: "IPO",
};

function formatEvent(row: Record<string, unknown>) {
  const dateStr = row.date as string;
  const d = new Date(dateStr + "T00:00:00Z");
  const day = String(d.getUTCDate());
  const month = MONTH_ABBR[d.getUTCMonth()];
  const year = d.getUTCFullYear();

  let time: string;
  if (row.timing === "bmo")      time = `${month} ${day}, ${year} · BMO`;
  else if (row.timing === "amc") time = `${month} ${day}, ${year} · AMC`;
  else if (row.time_utc)         time = `${month} ${day}, ${year} · ${(row.time_utc as string).slice(0, 5)} UTC`;
  else                           time = `${month} ${day}, ${year}`;

  // Normalise "med" → "medium" for frontend dot colour logic
  const rawImpact = row.impact as string | null;
  const impact = rawImpact === "med" ? "medium" : (rawImpact ?? "medium");

  const cat = row.category as string;

  return {
    date: dateStr,
    day,
    month,
    ts: d.getTime(),
    title: row.title,
    impact,
    time,
    desc: (row.detail as string | null) ?? null,
    source: (row.source_url as string | null) ?? null,
    category: cat,
    categoryLabel: CAT_LABEL[cat] ?? cat,
    event_type: row.event_type,
    symbol: row.symbol,
  };
}

// GET /api/next-event?asset=BTC-PERP&after=2026-06-25&upcoming=5
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const asset = searchParams.get("asset");
  const after = searchParams.get("after") ?? new Date().toISOString().slice(0, 10);
  const upcomingCount = Math.min(parseInt(searchParams.get("upcoming") ?? "5"), 10);

  if (!asset) {
    return NextResponse.json({ error: "asset required" }, { status: 400 });
  }

  const sym = asset.replace(/-PERP$/, "");
  const cats = ASSET_CATS[sym];
  if (!cats) {
    return NextResponse.json({ error: `unknown asset: ${asset}` }, { status: 404 });
  }

  const { data, error } = await db
    .from("calendar_events")
    .select("*")
    .in("category", cats)
    .gte("date", after)
    .order("date", { ascending: true })
    .order("time_utc", { ascending: true, nullsFirst: false })
    .limit(upcomingCount + 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data || data.length === 0) {
    return NextResponse.json(
      { next: null, upcoming: [] },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  const [nextRow, ...upcomingRows] = data as Record<string, unknown>[];

  return NextResponse.json(
    {
      next: formatEvent(nextRow),
      upcoming: upcomingRows.map(formatEvent),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
