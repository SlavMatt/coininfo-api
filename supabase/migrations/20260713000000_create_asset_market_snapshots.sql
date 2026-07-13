create table if not exists public.asset_market_snapshots (
  asset_key   text primary key,
  symbol      text not null,
  asset_class text not null check (asset_class = any (array['crypto', 'stock', 'index', 'commodity'])),
  source      text not null,
  market_data jsonb not null default '[]'::jsonb,
  fields      jsonb not null default '{}'::jsonb,
  source_urls jsonb not null default '{}'::jsonb,
  as_of       timestamp with time zone not null default now(),
  updated_at  timestamp with time zone not null default now()
);

create index if not exists idx_asset_market_snapshots_class
  on public.asset_market_snapshots using btree (asset_class, symbol);
