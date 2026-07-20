export type AssetClass = "crypto" | "stock" | "index" | "commodity";

export type MarketDataItem = {
  k: string;
  v: string;
  sub?: string;
};

export type AssetSnapshotRow = {
  asset_key: string;
  symbol: string;
  asset_class: AssetClass;
  source: string;
  market_data: MarketDataItem[];
  fields: Record<string, unknown>;
  source_urls: Record<string, string>;
  as_of: string;
  updated_at?: string;
};

export const US_STOCK_SYMBOLS = [
  "TSLA", "MU", "AMD", "CRCL", "INTC", "SNDK",
  "AAPL", "AMZN", "GOOGL", "META", "MSTR", "MSFT", "NVDA",
  "ARM", "WDC", "STX",
];

// KR stocks are quoted via their US OTC pink-sheet ticker rather than the
// raw KRX symbol (e.g. "005930.KS") — Finnhub's free-tier profile/metric
// endpoints have inconsistent coverage for foreign exchange suffixes, but
// reliably support standard US OTC tickers. The dashboard already displays
// "Ticker (OTC)" (SSNLF / HXSCL) alongside "Ticker (KRX)", so this makes the
// live data source match what's already shown to users.
export const FINNHUB_STOCK_SYMBOLS: Record<string, string> = {
  TSLA: "TSLA",
  MU: "MU",
  AMD: "AMD",
  CRCL: "CRCL",
  INTC: "INTC",
  SNDK: "SNDK",
  AAPL: "AAPL",
  AMZN: "AMZN",
  GOOGL: "GOOGL",
  META: "META",
  MSTR: "MSTR",
  MSFT: "MSFT",
  NVDA: "NVDA",
  ARM: "ARM",
  WDC: "WDC",
  STX: "STX",
  SAMSUNG: "SSNLF",
  SKHYNIX: "HXSCL",
};

// KR stocks keep a deliberately minimal card (Market Cap · Sector · Currency
// · Ticker KRX/OTC) — unlike US stocks they don't show P/E, EPS, or 52W
// Range, since those aren't consistently comparable for OTC-quoted ADRs.
// The stock cron checks this set to only merge Market Cap for these symbols.
export const KR_STOCK_SYMBOLS = new Set(["SAMSUNG", "SKHYNIX"]);

// Wikipedia REST API page titles (en.wikipedia.org/api/rest_v1/page/summary/{title})
// used to source the "About" description for non-crypto assets. Crypto assets
// continue to use CoinGecko's own description instead.
export const WIKI_TITLES: Record<string, string> = {
  // US Stock
  "TSLA-PERP":    "Tesla,_Inc.",
  "MU-PERP":      "Micron_Technology",
  "AMD-PERP":     "Advanced_Micro_Devices",
  "CRCL-PERP":    "Circle_(company)",
  "INTC-PERP":    "Intel",
  "SNDK-PERP":    "SanDisk",
  "AAPL-PERP":    "Apple_Inc.",
  "AMZN-PERP":    "Amazon_(company)",
  "GOOGL-PERP":   "Alphabet_Inc.",
  "META-PERP":    "Meta_Platforms",
  "MSTR-PERP":    "MicroStrategy",
  "MSFT-PERP":    "Microsoft",
  "NVDA-PERP":    "Nvidia",
  "SPCX-PERP":    "SpaceX",
  "STX-PERP":     "Seagate_Technology",
  "WDC-PERP":     "Western_Digital",
  // KR Stock
  "SAMSUNG-PERP": "Samsung_Electronics",
  "SKHYNIX-PERP": "SK_Hynix",
  // Indices
  "SP500-PERP":   "S%26P_500",
  "NDX100-PERP":  "Nasdaq-100",
  // Commodities
  "CL-PERP":      "West_Texas_Intermediate",
  "BZ-PERP":      "Brent_Crude",
  "XAU-PERP":     "Gold",
  "XAG-PERP":     "Silver",
};

// CoinGecko coin IDs for the About text of the 16 crypto pairs actually live
// on DipCoin (verified via `dipcoin-cli market pairs`) — the frontend's
// static ASSETS list only had 9 of these; LINK/AAVE/ZEC/TRUMP/PAXG/TRX/ADA
// are live on the real exchange but missing from the demo data.
export const CRYPTO_COINGECKO_IDS: Record<string, string> = {
  "BTC-PERP":   "bitcoin",
  "ETH-PERP":   "ethereum",
  "SUI-PERP":   "sui",
  "BNB-PERP":   "binancecoin",
  "SOL-PERP":   "solana",
  "XRP-PERP":   "ripple",
  "HYPE-PERP":  "hyperliquid",
  "LTC-PERP":   "litecoin",
  "DOGE-PERP":  "dogecoin",
  "LINK-PERP":  "chainlink",
  "AAVE-PERP":  "aave",
  "ZEC-PERP":   "zcash",
  "TRUMP-PERP": "official-trump",
  "PAXG-PERP":  "pax-gold",
  "TRX-PERP":   "tron",
  "ADA-PERP":   "cardano",
};

// Hard cap on the About text length, shared by every About source
// (Wikipedia, CoinGecko). Applied uniformly to EN/KO/JA — CJK text is
// denser per character, so 1000 chars of Korean/Japanese is if anything
// more generous than 1000 chars of English, never a risk of under-truncating.
export const MAX_ABOUT_CHARS = 1000;

// Cut at the last sentence boundary within the cap. Handles both the Latin
// ". " delimiter and the CJK full-width period "。" used by ja/ko/zh text.
export function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastLatin = cut.lastIndexOf(". ");
  const lastCjk = cut.lastIndexOf("。");
  const lastBoundary = Math.max(lastLatin, lastCjk);
  if (lastBoundary > maxChars * 0.5) return cut.slice(0, lastBoundary + 1);
  return cut.trimEnd() + "…";
}

// Keys written by cron/wiki-about that must survive other crons' upserts.
const ABOUT_KEYS = [
  "about", "aboutSource", "aboutUrl",
  "about_ko", "aboutUrl_ko",
  "about_ja", "aboutUrl_ja",
] as const;

// Market-data crons overwrite the `fields` column wholesale on upsert. The
// wiki-about cron writes about/about_ko/about_ja (+ source/url variants)
// into that same column via a read-merge-write, so any market-data cron
// running afterwards would silently wipe the descriptions unless it
// re-merges those keys back in first. Call this right before upserting `rows`.
export async function preserveAboutFields<T extends { asset_key: string; fields: Record<string, unknown> }>(
  db: { from: (table: string) => any },
  rows: T[]
): Promise<T[]> {
  if (!rows.length) return rows;
  const keys = rows.map((r) => r.asset_key);
  const { data } = await db
    .from("asset_market_snapshots")
    .select("asset_key, fields")
    .in("asset_key", keys);

  const aboutByKey = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    const f = row.fields ?? {};
    if (f.about) {
      const preserved: Record<string, unknown> = {};
      for (const key of ABOUT_KEYS) if (f[key] !== undefined) preserved[key] = f[key];
      aboutByKey.set(row.asset_key, preserved);
    }
  }

  return rows.map((row) => {
    const preserved = aboutByKey.get(row.asset_key);
    return preserved ? { ...row, fields: { ...row.fields, ...preserved } } : row;
  });
}

export function jsonHeaders(cache = "public, s-maxage=300, stale-while-revalidate=600") {
  return {
    "Cache-Control": cache,
    "Access-Control-Allow-Origin": "*",
  };
}

export function compactNumber(value: unknown, decimals = 2): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;

  const abs = Math.abs(n);
  const units = [
    { v: 1e12, s: "T" },
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "K" },
  ];
  const unit = units.find((u) => abs >= u.v);
  if (!unit) return formatNumber(n, decimals);
  return `${trimZeros(n / unit.v, decimals)}${unit.s}`;
}

export function usdCompact(value: unknown, decimals = 2): string {
  const s = compactNumber(value, decimals);
  return s ? `$${s}` : "—";
}

export function formatNumber(value: unknown, decimals = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPercent(value: unknown, decimals = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${trimZeros(n, decimals)}%`;
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function firstMetric(metric: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    const value = metric[name];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function trimZeros(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}
