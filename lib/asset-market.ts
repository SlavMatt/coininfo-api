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
  SAMSUNG: "005930.KS",
  SKHYNIX: "000660.KS",
};

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
