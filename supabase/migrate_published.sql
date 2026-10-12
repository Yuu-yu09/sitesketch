-- Published sites are compiled to HTML at publish time and stored here.
--
-- Why a column rather than the `sites` Storage bucket that schema.sql also
-- creates: the compiled document has to be served with our own security
-- headers, and a Storage object is returned by the CDN with none of them.
-- Serving from this origin means /site/<slug> can answer with
-- `script-src 'none'`, which is the real backstop for HTML a user wrote.
-- The bucket is still there for the ZIP export.
--
-- Idempotent: safe to run against a database that already has the columns.

alter table projects add column if not exists published_pages jsonb;
alter table projects add column if not exists published_at timestamptz;
-- Which key in published_pages is the home page.
--
-- This has to be stored rather than worked out. published_pages is jsonb, and
-- jsonb does not preserve key order: it reorders by key length and then
-- bytewise. So {"home": ..., "faq": ..., "about-us": ...} comes back as
-- faq, home, about-us, and picking the first key served the FAQ page at
-- /site/<slug> on every multi-page site.
alter table projects add column if not exists published_home text;

comment on column projects.published_pages is
  'Compiled HTML per page: {"home": "<!doctype html>...", "about": "..."}';
comment on column projects.published_at is
  'When the currently stored compiled pages were produced';
comment on column projects.published_home is
  'Key in published_pages that /site/<slug> should serve';
