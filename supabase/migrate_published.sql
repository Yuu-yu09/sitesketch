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

comment on column projects.published_pages is
  'Compiled HTML per page: {"home": "<!doctype html>...", "about": "..."}';
comment on column projects.published_at is
  'When the currently stored compiled pages were produced';
