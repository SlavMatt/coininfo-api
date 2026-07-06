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

-- Note: the ipo column always returns 0 — category='ipo' is not in the
-- calendar_events CHECK constraint, so no rows can have that value.
-- TODO: apply the following in Supabase SQL Editor (MCP has no write access):
--   CREATE OR REPLACE VIEW public.calendar_daily_counts AS
--   SELECT date,
--     count(*) FILTER (WHERE category = 'crypto')      AS crypto,
--     count(*) FILTER (WHERE category = 'stock')       AS stock,
--     count(*) FILTER (WHERE category = 'commodities') AS commodities,
--     count(*) FILTER (WHERE category = 'economic')    AS economic,
--     count(*) FILTER (WHERE category = 'ipo')         AS ipo
--   FROM calendar_events GROUP BY date;
create view public.calendar_daily_counts as
  select
    date,
    count(*) filter (where category = 'crypto')      as crypto,
    count(*) filter (where category = 'stock')       as stock,
    count(*) filter (where category = 'commodities') as commodities,
    count(*) filter (where category = 'economic')    as economic,
    count(*) filter (where category = 'ipo')         as ipo
  from calendar_events
  group by date;
