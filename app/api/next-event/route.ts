import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Asset symbol (without -PERP) → DB categories to search
// Crypto/stock/commodities: asset-class events only (no macro)
// Index: economic included so macro events appear
const ASSET_CATS: Record<string, string[]> = {
  BTC:     ["crypto"],
  ETH:     ["crypto"],
  SOL:     ["crypto"],
  BNB:     ["crypto"],
  DOGE:    ["crypto"],
  XRP:     ["crypto"],
  LTC:     ["crypto"],
  SUI:     ["crypto"],
  HYPE:    ["crypto"],
  STX:     ["crypto"],
  TSLA:    ["stock"],
  NVDA:    ["stock"],
  AMD:     ["stock"],
  AAPL:    ["stock"],
  MSFT:    ["stock"],
  META:    ["stock"],
  AMZN:    ["stock"],
  GOOGL:   ["stock"],
  MU:      ["stock"],
  INTC:    ["stock"],
  MSTR:    ["stock"],
  ARM:     ["stock"],
  WDC:     ["stock"],
  SNDK:    ["stock"],
  SKHYNIX: ["stock"],
  SAMSUNG: ["stock"],
  CRCL:    ["stock"],
  CL:      ["commodities"],
  BZ:      ["commodities"],
  XAU:     ["commodities"],
  XAG:     ["commodities"],
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

// Index assets show broad category events (economic macro + category-wide)
const INDEX_SYMBOLS = new Set(["NDX100", "SP500", "SPCX"]);

// BTC/ETH/SOL have their own Deribit options events
// Other crypto falls back to showing BTC+ETH events as market proxy
const CRYPTO_FLAGSHIP = new Set(["BTC", "ETH", "SOL"]);

// Energy: EIA used to store symbol="WTI"; new rows use CL/BZ.
// Include "WTI" as fallback while old rows persist.
const SYMBOL_LOOKUP: Record<string, string[]> = {
  CL: ["CL", "WTI"],
  BZ: ["BZ", "WTI"],
};

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

  // Resolve which DB symbols to search for this asset
  function resolveSymbols(s: string): string[] | null {
    if (SYMBOL_LOOKUP[s]) return SYMBOL_LOOKUP[s];
    if (cats.includes("crypto") && !CRYPTO_FLAGSHIP.has(s)) return ["BTC", "ETH"];
    return null; // null = use single .eq("symbol", s)
  }

  const symbolOverride = resolveSymbols(sym);

  let nextRow: Record<string, unknown> | undefined;
  let upcomingRows: Record<string, unknown>[];
  let queryError: { message: string } | null = null;

  if (INDEX_SYMBOLS.has(sym)) {
    // Index assets: show symbol-specific events + broad category events (macro, etc.)
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

    const { data: broadData, error } = await db
      .from("calendar_events")
      .select("*")
      .in("category", cats)
      .not("event_type", "in", `(${EXCLUDED_TYPES.join(",")})`)
      .gte("date", after)
      .order("date", { ascending: true })
      .order("time_utc", { ascending: true, nullsFirst: false })
      .limit(upcomingCount + 2);

    queryError = error;
    const allRows = broadData as Record<string, unknown>[] ?? [];
    const ownRow = ownData?.[0] as Record<string, unknown> | undefined;
    const broadFirst = allRows[0];

    if (ownRow && (!broadFirst || (ownRow.date as string) <= (broadFirst.date as string))) {
      nextRow = ownRow;
      upcomingRows = allRows.filter((r) => r.id !== ownRow.id).slice(0, upcomingCount);
    } else if (ownRow) {
      nextRow = broadFirst;
      const rest = allRows.slice(1).filter((r) => r.id !== ownRow.id);
      const insertIdx = rest.findIndex((r) => (r.date as string) >= (ownRow.date as string));
      if (insertIdx === -1) rest.push(ownRow);
      else rest.splice(insertIdx, 0, ownRow);
      upcomingRows = rest.slice(0, upcomingCount);
    } else {
      nextRow = allRows[0];
      upcomingRows = allRows.slice(1, upcomingCount + 1);
    }
  } else {
    // Non-index assets: query own symbol, with fallbacks for certain asset classes
    let q = db
      .from("calendar_events")
      .select("*")
      .in("category", cats)
      .not("event_type", "in", `(${EXCLUDED_TYPES.join(",")})`)
      .gte("date", after)
      .order("date", { ascending: true })
      .order("time_utc", { ascending: true, nullsFirst: false })
      .limit(upcomingCount + 2);

    if (symbolOverride) {
      q = q.in("symbol", symbolOverride);
    } else {
      q = q.eq("symbol", sym);
    }

    const { data, error } = await q;
    queryError = error;
    const allRows = data as Record<string, unknown>[] ?? [];
    nextRow = allRows[0];
    upcomingRows = allRows.slice(1, upcomingCount + 1);
  }

  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 });

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
