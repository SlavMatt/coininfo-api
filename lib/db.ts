import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const db = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export type CalendarEvent = {
  id: string;
  date: string;
  time_utc: string | null;
  category: "crypto" | "stock" | "commodities" | "ipo";
  event_type: string | null;
  symbol: string | null;
  title: string;
  country: string | null;
  impact: "high" | "med" | "low" | null;
  actual: string | null;
  forecast: string | null;
  prior: string | null;
  unit: string | null;
  detail: string | null;
  source_url: string | null;
  timing: "bmo" | "amc" | null;
  eps_surprise: number | null;
  revenue_actual: string | null;
  revenue_forecast: string | null;
  exchange: string | null;
  price_range: string | null;
  raise_usd: number | null;
  ipo_status: string | null;
  underlying: string | null;
  oi_usd: number | null;
  max_pain: number | null;
  net_flow_usd: number | null;
  source: string;
};
