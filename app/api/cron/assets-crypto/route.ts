import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PLATFORM_CRYPTO_MAP } from "@/lib/constants";
import {
  AssetSnapshotRow,
  formatDate,
  formatNumber,
  formatPercent,
  jsonHeaders,
  usdCompact,
} from "@/lib/asset-market";
import { logCronFailure } from "@/lib/log";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ids = Object.keys(PLATFORM_CRYPTO_MAP).join(",");
  const marketsUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h`;
  const globalUrl = "https://api.coingecko.com/api/v3/global";

  const [marketsRes, globalRes] = await Promise.all([
    fetch(marketsUrl, { headers: { Accept: "application/json" } }),
    fetch(globalUrl, { headers: { Accept: "application/json" } }),
  ]);

  if (!marketsRes.ok) {
    logCronFailure("cron/assets-crypto", "coingecko markets error", marketsRes.status);
    return NextResponse.json({ error: "coingecko markets error", status: marketsRes.status }, { status: 502 });
  }
  if (!globalRes.ok) {
    logCronFailure("cron/assets-crypto", "coingecko global error", globalRes.status);
    return NextResponse.json({ error: "coingecko global error", status: globalRes.status }, { status: 502 });
  }

  const items: any[] = await marketsRes.json();
  const globalData: any = await globalRes.json();
  const totalCryptoMarketCap = Number(globalData?.data?.total_market_cap?.usd);
  const now = new Date().toISOString();

  const rows: AssetSnapshotRow[] = items
    .filter((item) => PLATFORM_CRYPTO_MAP[item.id])
    .map((item) => {
      const symbol = PLATFORM_CRYPTO_MAP[item.id];
      const dominance = Number.isFinite(totalCryptoMarketCap) && item.market_cap
        ? (Number(item.market_cap) / totalCryptoMarketCap) * 100
        : null;
      const circ = Number(item.circulating_supply);
      const max = Number(item.max_supply);
      const circulatingRate = Number.isFinite(circ) && Number.isFinite(max) && max > 0
        ? (circ / max) * 100
        : null;

      return {
        asset_key: `${symbol}-PERP`,
        symbol,
        asset_class: "crypto",
        source: "coingecko",
        as_of: now,
        market_data: [
          { k: "Rank", v: item.market_cap_rank ? `#${item.market_cap_rank}` : "—" },
          { k: "24h Volume", v: usdCompact(item.total_volume) },
          { k: "Market Cap", v: usdCompact(item.market_cap) },
          { k: "Vol / MCap", v: item.market_cap ? formatPercent((Number(item.total_volume) / Number(item.market_cap)) * 100) : "—" },
          { k: "FDV", v: usdCompact(item.fully_diluted_valuation) },
          { k: "Market Dominance", v: dominance == null ? "—" : formatPercent(dominance) },
          { k: "Circulating Supply", v: formatNumber(item.circulating_supply, 0) },
          { k: "Max Supply", v: item.max_supply ? formatNumber(item.max_supply, 0) : "∞" },
        ],
        fields: {
          rank: item.market_cap_rank ? `#${item.market_cap_rank}` : null,
          dominance: dominance == null ? null : formatPercent(dominance),
          ath: item.ath != null ? `$${formatNumber(item.ath, 4)}` : null,
          athDate: formatDate(item.ath_date),
          atl: item.atl != null ? `$${formatNumber(item.atl, 6)}` : null,
          atlDate: formatDate(item.atl_date),
          totalSupply: item.total_supply ? formatNumber(item.total_supply, 0) : null,
          circulatingRate: circulatingRate == null ? null : formatPercent(circulatingRate),
        },
        source_urls: {
          coingecko: `https://www.coingecko.com/en/coins/${item.id}`,
        },
      };
    });

  if (rows.length === 0) return NextResponse.json({ upserted: 0 });

  const { error } = await db.from("asset_market_snapshots").upsert(rows, { onConflict: "asset_key" });
  if (error) {
    logCronFailure("cron/assets-crypto", "supabase upsert failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length, symbols: rows.map((r) => r.symbol) }, { headers: jsonHeaders() });
}
