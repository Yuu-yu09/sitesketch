-- Password resets, and the token version that lets a reset end old sessions.
--
-- Same statements as the corresponding section of schema.sql: schema.sql is
-- what a new database is built from, this is what an existing one is brought
-- up to date with. Idempotent, so running it twice is fine.
--
--   .\.venv\Scripts\python.exe scripts\apply_migrations.py

alter table users add column if not exists token_version int not null default 0;

create table if not exists password_resets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists password_resets_user_idx on password_resets(user_id);

create index if not exists password_resets_live_idx
  on password_resets(expires_at) where used_at is null;
