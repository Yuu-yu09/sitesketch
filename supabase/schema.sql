-- ============================================================
-- SiteSketch - Supabase (Postgres) schema
-- Run once in Supabase dashboard -> SQL Editor, or:
--   psql "$DATABASE_URL" -f supabase/schema.sql
-- Idempotent: safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- users ----------
-- Password auth: password_hash is a werkzeug/bcrypt hash, never plain text.
-- OAuth (optional later): add oauth_accounts from auth_provider below.
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  email         text unique not null,
  password_hash text not null,
  role          text not null default 'user',      -- 'user' | 'admin'
  created_at    timestamptz not null default now()
);

-- Optional: sign-in with Google / GitHub (users table stays the identity).
-- create table if not exists oauth_accounts (
--   id             uuid primary key default gen_random_uuid(),
--   user_id        uuid references users(id) on delete cascade,
--   provider       text not null,                  -- 'google' | 'github'
--   provider_uid   text not null,                  -- provider's account id
--   created_at     timestamptz not null default now(),
--   unique (provider, provider_uid)
-- );

-- ---------- taxonomy (seed data, admin-editable) ----------
-- ids are slugs ('business', 'get-contact') to match the section library in
-- static/js/api.js and the design engine keys - no id translation layer.
create table if not exists website_types (
  id          text primary key,                   -- 'business' | 'portfolio' | ...
  name        text not null,
  description text,
  icon        text,
  sort_order  int not null default 0
);

create table if not exists goals (
  id         text primary key,                    -- 'get-contact'
  type_id    text references website_types(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  unique (type_id, name)
);

create table if not exists section_templates (
  id            text primary key,                 -- 'business.hero'
  type_id       text references website_types(id) on delete cascade,
  section_type  text not null,                    -- hero | menu | gallery | ...
  name          text not null,
  sort_order    int not null default 0,
  default_json  jsonb not null default '{}'::jsonb,
  checklist_items jsonb not null default '[]'::jsonb,
  unique (type_id, section_type)
);

-- ---------- projects ----------
-- plan_json holds the whole Plan + design spec (the single source of truth
-- for the builder and the compiled site).
create table if not exists projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete cascade,
  type_id      text references website_types(id),
  goal_id      text references goals(id),
  name         text not null,
  plan_json    jsonb not null default '{}'::jsonb,
  theme        text not null default 'modern',
  slug         text unique,
  is_published boolean not null default false,
  -- Compiled HTML per page, produced in the browser at publish time so the
  -- published site needs no JavaScript. See supabase/migrate_published.sql.
  published_pages jsonb,
  published_at   timestamptz,
  view_count   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists projects_user_idx    on projects(user_id);
create index if not exists projects_published_idx on projects(is_published) where is_published;

-- ---------- media library (images the user uploads) ----------
create table if not exists media (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  name          text not null,
  path          text not null,                 -- object key inside the bucket
  url           text not null,                 -- public CDN url
  content_type  text,
  size_bytes    int,
  created_at    timestamptz not null default now()
);

create index if not exists media_user_idx on media(user_id, created_at desc);

-- ---------- ai usage log (evidence for the defense) ----------
create table if not exists ai_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  kind       text not null,                       -- 'plan' | 'design' | 'section' | 'redesign'
  ok         boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_logs_user_idx on ai_logs(user_id, created_at desc);

-- ---------- keep updated_at honest ----------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_touch on projects;
create trigger projects_touch
  before update on projects
  for each row execute function touch_updated_at();

-- ---------- published-site storage bucket ----------
-- Compiled sites are uploaded here (Vercel's filesystem is read-only).
-- Public so /site/<slug> can be served without signing every read.
insert into storage.buckets (id, name, public)
values
  ('sites', 'sites', true),
  ('media', 'media', true)
on conflict (id) do update set public = excluded.public;