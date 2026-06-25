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

  // Exclude price_update (CoinGecko daily snapshots — not calendar events)
  const EXCLUDED_TYPES = ["price_update"];

  // 1. Try to find events specific to this symbol first (e.g. TSLA earnings for TSLA-PERP)
  const { data: ownData } = await db
    .from("calendar_events")
    .select("*")
    .eq("symbol", sym)
    .in("category", cats)
    .not("event_type", "in", `(${EXCLUDED_TYPES.join(",")})`)
    .gte("date", after)
    .order("date", { ascending: true })
    .order("time_utc", { ascending: true, nullsFirst: false })
    .limit(1);

  // 2. Fetch broader category events (excluding price_update), more than we need so we can merge
  const { data: broadData, error } = await db
    .from("calendar_events")
    .select("*")
    .in("category", cats)
    .not("event_type", "in", `(${EXCLUDED_TYPES.join(",")})`)
    .gte("date", after)
    .order("date", { ascending: true })
    .order("time_utc", { ascending: true, nullsFirst: false })
    .limit(upcomingCount + 2);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const allRows = broadData as Record<string, unknown>[] ?? [];

  // If we found a symbol-specific event and it's earlier than the broad #1, promote it
  let nextRow: Record<string, unknown> | undefined;
  let upcomingRows: Record<string, unknown>[];

  const ownRow = ownData?.[0] as Record<string, unknown> | undefined;
  const broadFirst = allRows[0];

  if (ownRow && (!broadFirst || (ownRow.date as string) <= (broadFirst.date as string))) {
    // Own event is at least as early as the broad first — use it as next
    nextRow = ownRow;
    upcomingRows = allRows.filter((r) => r.id !== ownRow.id).slice(0, upcomingCount);
  } else if (ownRow) {
    // Own event exists but a broader event is earlier — show broader first, own event in upcoming
    nextRow = broadFirst;
    const rest = allRows.slice(1).filter((r) => r.id !== ownRow.id);
    // Insert ownRow at correct date position in rest
    const insertIdx = rest.findIndex((r) => (r.date as string) >= (ownRow.date as string));
    if (insertIdx === -1) rest.push(ownRow);
    else rest.splice(insertIdx, 0, ownRow);
    upcomingRows = rest.slice(0, upcomingCount);
  } else {
    // No symbol-specific event — use chronological order from broad query
    nextRow = allRows[0];
    upcomingRows = allRows.slice(1, upcomingCount + 1);
  }

  if (!nextRow) {
    return NextResponse.json(
      { next: null, upcoming: [] },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

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
