-- Manually archived snapshot of the production schema (Supabase project
-- tvvtsxvgitfhbmgrqswc), reconstructed from information_schema/pg_catalog
-- output on 2026-07-01. Not authoritative migration tooling — MCP has no
-- write/introspection access to this project, so schema changes still have
-- to be applied by hand in the Supabase SQL Editor and then reflected here.
--
-- KNOWN ISSUE (see calendar_events_category_check below): the CHECK
-- constraint does not include 'ipo', but app/api/cron/ipo/route.ts and
-- app/api/admin/backfill-ipo/route.ts both insert category: 'ipo'. Any
-- invocation of those routes fails the constraint and 500s. IPO cron is
-- already not scheduled in vercel.json (see "chore: remove IPO cron"
-- commit), so this has probably been silently broken/unused rather than
-- actively failing in production.

create table public.calendar_events (
  id                text primary key,
  date              date not null,
  time_utc          time without time zone,
  category          text not null check (category = any (array['crypto', 'stock', 'economic', 'commodities'])),
  event_type        text,
  symbol            text,
  title             text not null,
  country           text,
  impact            text check (impact = any (array['high', 'med', 'low'])),
  actual            text,
  forecast          text,
  prior             text,
  unit              text,
  detail            text,
  source_url        text,
  timing            text check (timing = any (array['bmo', 'amc'])),
  eps_surprise      numeric,
  revenue_actual    text,
  revenue_forecast  text,
  exchange          text,
  price_range       text,
  raise_usd         numeric,
  ipo_status        text,
  underlying        text,
  oi_usd            numeric,
  max_pain          numeric,
  net_flow_usd      numeric,
  source            text not null,
  created_at        timestamp with time zone default now(),
  updated_at        timestamp with time zone default now()
);

create index idx_cal_date_cat on public.calendar_events using btree (date, category);
create index idx_cal_symbol   on public.calendar_events using btree (symbol, date);
create index idx_cal_category on public.calendar_events using btree (category, date);

-- Likely a VIEW (no PK/indexes/constraints returned by pg_catalog for it),
-- probably a per-day aggregate over calendar_events grouped by category.
-- Definition unknown — dump it with:
--   select pg_get_viewdef('public.calendar_daily_counts', true);
-- and paste the result back to be added here.
-- create view public.calendar_daily_counts as ...
--   date          date,
--   crypto        bigint,
--   stock         bigint,
--   commodities   bigint,
--   ipo           bigint
