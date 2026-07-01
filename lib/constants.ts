// Single source of truth for platform symbol lists.
// Previously these were copy-pasted independently across cron/admin routes
// and had drifted (cron/stock included ARM/WDC, backfill-stock and cleanup
// did not — cleanup was deleting ARM/WDC earnings every week as "non-platform").

export const PLATFORM_STOCKS = [
  "TSLA", "MU", "AMD", "CRCL", "INTC", "SNDK",
  "AAPL", "AMZN", "GOOGL", "META", "MSTR", "MSFT", "NVDA", "SPCX",
  "ARM", "WDC",
];

// CoinGecko coin id -> platform symbol
export const PLATFORM_CRYPTO_MAP: Record<string, string> = {
  "bitcoin":        "BTC",
  "ethereum":       "ETH",
  "solana":         "SOL",
  "ripple":         "XRP",
  "binancecoin":    "BNB",
  "cardano":        "ADA",
  "dogecoin":       "DOGE",
  "litecoin":       "LTC",
  "tron":           "TRX",
  "sui":            "SUI",
  "hyperliquid":    "HYPE",
  "official-trump": "TRUMP",
  "axie-infinity":  "AXS",
  "aave":           "AAVE",
  "chainlink":      "LINK",
  "pax-gold":       "PAXG",
  "zcash":          "ZEC",
};

export const PLATFORM_CRYPTO = Object.values(PLATFORM_CRYPTO_MAP);

// Subset of PLATFORM_STOCKS that actually pays dividends
export const DIVIDEND_SYMBOLS = [
  "AAPL",   // ~$0.25/quarter
  "MSFT",   // ~$0.83/quarter
  "NVDA",   // ~$0.01/quarter
  "INTC",   // ~$0.08/quarter
  "META",   // ~$0.50/quarter (since 2024)
  "GOOGL",  // ~$0.20/quarter (since 2024)
  "WDC",    // Western Digital
  "MU",     // Micron (small)
];

// Platform Korean stocks: Finnhub symbol -> internal symbol
export const KR_STOCKS = [
  { finnhub: "000660.KS", symbol: "SKHYNIX", name: "SK Hynix",            country: "KR" },
  { finnhub: "005930.KS", symbol: "SAMSUNG", name: "Samsung Electronics", country: "KR" },
];
