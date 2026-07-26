-- ============================================================================
-- inspect-production-schema.sql  —  READ-ONLY production inventory
-- ============================================================================
-- WHY: the repo contains no CREATE TABLE for leads / customers / sales_tasks /
-- orders / quotes / sync_progress (base44-era tables), and 27 of 58 migrations
-- have no GitHub Actions workflow — so their application state is unknown.
-- Nothing about the live schema can be assumed from source control.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   It returns ONE result set with a single `report` column. Use the editor's
--   "Download CSV" (or select the grid and copy) and send the whole thing back.
--
-- SAFETY
--   Every statement is a SELECT against catalogs plus COUNT/GROUP BY over your
--   own tables. No DDL, no DML, no locks beyond a catalog read. Safe to run on
--   production during business hours.
--
-- ROBUSTNESS
--   * Tables and columns that do not exist are skipped, not errored on — the
--     whole point is that we do not know what exists.
--   * pg_get_functiondef() is NOT used: it raises 42809 on aggregates, and the
--     planner is free to evaluate it before the schema filter. p.prosrc gives
--     the same answer without the landmine.
-- ============================================================================

WITH
-- Tables we care about, and which of them actually exist here.
targets(tbl) AS (
  VALUES ('leads'),('customers'),('sales_tasks'),('orders'),('quotes'),
         ('communication_logs'),('call_logs'),('lead_activity_logs'),
         ('support_tickets'),('club_signups'),('sync_progress'),
         ('lead_counters'),('task_counters'),('dashboard_counters'),
         ('marketing_costs'),('upsell_suggestions'),('audit_logs'),
         ('whatsapp_chats'),('whatsapp_messages'),('whatsapp_message_logs')
),
present AS (
  SELECT tbl FROM targets WHERE to_regclass('public.' || quote_ident(tbl)) IS NOT NULL
),

-- ── 1. Columns ─────────────────────────────────────────────────────────────
sec_cols AS (
  SELECT 1 AS ord, row_number() OVER (ORDER BY c.table_name, c.ordinal_position) AS sub,
         format('%-20s %3s  %-28s %-26s %-8s %s',
                c.table_name, c.ordinal_position, c.column_name, c.data_type,
                CASE WHEN c.is_nullable = 'YES' THEN 'NULL' ELSE 'NOT NULL' END,
                COALESCE(left(c.column_default, 40), '')) AS line
  FROM information_schema.columns c
  JOIN present p ON p.tbl = c.table_name
  WHERE c.table_schema = 'public'
),

-- ── 2. Foreign keys + ON DELETE  ← THE decisive block for the wipe ─────────
-- If quotes.lead_id / orders.lead_id carry NO ACTION or RESTRICT, then
-- DELETE FROM leads fails outright instead of orphaning rows.
sec_fk AS (
  SELECT 2 AS ord, row_number() OVER (ORDER BY rel.relname, con.conrelid::regclass::text) AS sub,
         format('%-22s ← %-24s %-14s %s',
                rel.relname,
                con.conrelid::regclass::text,
                CASE con.confdeltype
                  WHEN 'a' THEN 'NO ACTION!'
                  WHEN 'r' THEN 'RESTRICT!'
                  WHEN 'c' THEN 'CASCADE'
                  WHEN 'n' THEN 'SET NULL'
                  WHEN 'd' THEN 'SET DEFAULT'
                END,
                pg_get_constraintdef(con.oid)) AS line
  FROM pg_constraint con
  JOIN pg_class     rel ON rel.oid = con.confrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN present        p ON p.tbl = rel.relname
  WHERE con.contype = 'f' AND nsp.nspname = 'public'
),

-- ── 3. PK / UNIQUE / CHECK ─────────────────────────────────────────────────
sec_con AS (
  SELECT 3 AS ord, row_number() OVER (ORDER BY rel.relname, con.contype, con.conname) AS sub,
         format('%-20s %-12s %s',
                rel.relname,
                CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE' ELSE 'CHECK' END,
                pg_get_constraintdef(con.oid)) AS line
  FROM pg_constraint con
  JOIN pg_class     rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN present        p ON p.tbl = rel.relname
  WHERE nsp.nspname = 'public' AND con.contype IN ('p','u','c')
),

-- ── 4. Indexes ─────────────────────────────────────────────────────────────
sec_idx AS (
  SELECT 4 AS ord, row_number() OVER (ORDER BY i.tablename, i.indexname) AS sub,
         format('%-20s %s', i.tablename, i.indexdef) AS line
  FROM pg_indexes i
  JOIN present p ON p.tbl = i.tablename
  WHERE i.schemaname = 'public'
),

-- ── 5. Triggers ────────────────────────────────────────────────────────────
-- These must be disabled during a bulk import: they fire per row and the
-- activity-log one doubles write volume.
sec_trg AS (
  SELECT 5 AS ord, row_number() OVER (ORDER BY t.tgrelid::regclass::text, t.tgname) AS sub,
         format('%-20s %s', t.tgrelid::regclass::text, pg_get_triggerdef(t.oid)) AS line
  FROM pg_trigger t
  JOIN pg_class     rel ON rel.oid = t.tgrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN present        p ON p.tbl = rel.relname
  WHERE NOT t.tgisinternal AND nsp.nspname = 'public'
),

-- ── 6. RLS state + policies ────────────────────────────────────────────────
-- 20240202000001 used `CREATE POLICY IF NOT EXISTS`, which is invalid
-- PostgreSQL — it may have enabled RLS without creating any policy, which
-- locks the table to every non-service-role client.
sec_rls AS (
  SELECT 6 AS ord, row_number() OVER (ORDER BY rel.relname) AS sub,
         format('%-20s rls_enabled=%-6s rls_forced=%s',
                rel.relname, rel.relrowsecurity, rel.relforcerowsecurity) AS line
  FROM pg_class rel
  JOIN present p ON p.tbl = rel.relname
  WHERE rel.relnamespace = 'public'::regnamespace AND rel.relkind = 'r'
),
sec_pol AS (
  SELECT 7 AS ord, row_number() OVER (ORDER BY pol.tablename, pol.policyname) AS sub,
         format('%-20s %-28s %-8s %s  USING(%s)',
                pol.tablename, pol.policyname, pol.cmd, pol.roles::text,
                left(COALESCE(pol.qual, '—'), 120)) AS line
  FROM pg_policies pol
  JOIN present p ON p.tbl = pol.tablename
  WHERE pol.schemaname = 'public'
),

-- ── 8. Table-level grants ──────────────────────────────────────────────────
-- No GRANT on any of these tables exists in any migration, so the effective
-- privileges of anon / authenticated are whatever the project defaults are.
sec_grant AS (
  SELECT 8 AS ord, row_number() OVER (ORDER BY g.table_name, g.grantee) AS sub,
         format('%-20s %-16s %s', g.table_name, g.grantee,
                string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type)) AS line
  FROM information_schema.role_table_grants g
  JOIN present p ON p.tbl = g.table_name
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('anon','authenticated','service_role')
  GROUP BY g.table_name, g.grantee
),

-- ── 9. Views + functions that read leads/customers ─────────────────────────
-- These must be re-pointed or recreated after the restructure. rep_stats in
-- particular is queried by /Representatives but has no definition in the repo.
sec_view AS (
  SELECT 9 AS ord, row_number() OVER (ORDER BY v.table_name) AS sub,
         format('VIEW     %s', v.table_name) AS line
  FROM information_schema.views v
  WHERE v.table_schema = 'public'
    AND (v.view_definition ILIKE '%leads%' OR v.view_definition ILIKE '%customers%')
),
sec_fn AS (
  -- prosrc, NOT pg_get_functiondef: the latter raises 42809 on aggregates and
  -- the planner may run it before the namespace filter. prokind='f' also skips
  -- aggregates ('a'), window functions ('w') and procedures ('p').
  SELECT 10 AS ord, row_number() OVER (ORDER BY pr.proname) AS sub,
         format('FUNCTION %s(%s)', pr.proname,
                left(pg_get_function_identity_arguments(pr.oid), 60)) AS line
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.prokind = 'f'
    AND pr.prosrc ILIKE '%leads%'
),

-- ── 11. Row counts (only for tables that exist) ────────────────────────────
-- query_to_xml runs a dynamic count without needing a DO block; the CASE
-- guarantees it is never reached for a table that does not exist.
sec_counts AS (
  SELECT 11 AS ord, row_number() OVER (ORDER BY t.tbl) AS sub,
         format('%-24s %s', t.tbl, COALESCE(c.n::text, 'n/a')) AS line
  FROM present t
  CROSS JOIN LATERAL (
    SELECT (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM public.%I', t.tbl),
                               false, true, '')))[1]::text::bigint AS n
  ) c
),

-- ── 12. Phone format spread — the duplicate problem, quantified ────────────
sec_fmt AS (
  SELECT 12 AS ord, row_number() OVER (ORDER BY count(*) DESC) AS sub,
         format('%-42s %s', fmt, count(*)) AS line
  FROM (
    SELECT CASE
      WHEN phone IS NULL OR btrim(phone) = ''  THEN 'empty'
      WHEN phone ~ '@[cg]\.us$'                THEN 'WhatsApp chat id       (972…@c.us)'
      WHEN phone ~ '^0\d{9}$'                  THEN 'local, no separators   (0501234567)'
      WHEN phone ~ '^0\d{8}$'                  THEN 'local landline         (031234567)'
      WHEN phone ~ '^0\d{1,2}[- ]\d{7,8}$'     THEN 'local with separator   (050-1234567)'
      WHEN phone ~ '^\+972'                    THEN 'international plus     (+972501234567)'
      WHEN phone ~ '^00972'                    THEN 'international 00       (00972501234567)'
      WHEN phone ~ '^972'                      THEN 'international bare     (972501234567)'
      WHEN phone ~ '^[57]\d{8}$'               THEN 'local, no leading zero (501234567)'
      WHEN phone ~ '[^0-9+\-() ]'              THEN 'contains letters/junk'
      ELSE                                          'other / malformed'
    END AS fmt
    FROM public.leads
  ) f
  GROUP BY fmt
),

-- ── 13. How many duplicate people hide behind format differences ───────────
sec_dup AS (
  SELECT 13 AS ord, 1 AS sub,
         format('leads: %s with phone | %s distinct raw | %s distinct normalized | %s duplicates caused by formatting',
                total, raw, norm, raw - norm) AS line
  FROM (
    SELECT count(*) AS total,
           count(DISTINCT phone) AS raw,
           count(DISTINCT right(regexp_replace(phone, '\D', '', 'g'), 9)) AS norm
    FROM public.leads
    WHERE phone IS NOT NULL AND btrim(phone) <> ''
  ) q
  UNION ALL
  SELECT 13, 2,
         format('customers: %s with phone | %s distinct normalized | %s DUPLICATE CUSTOMER ROWS',
                total, norm, total - norm)
  FROM (
    SELECT count(*) AS total,
           count(DISTINCT right(regexp_replace(phone, '\D', '', 'g'), 9)) AS norm
    FROM public.customers
    WHERE phone IS NOT NULL AND btrim(phone) <> ''
  ) q
),
-- The worst offenders, so the merge rule can be eyeballed before it runs.
sec_dupex AS (
  SELECT 14 AS ord, row_number() OVER (ORDER BY count(*) DESC) AS sub,
         format('%-12s x%-3s  %-44s %s',
                right(regexp_replace(phone, '\D', '', 'g'), 9),
                count(*),
                left(string_agg(DISTINCT phone, ' | '), 44),
                left(string_agg(DISTINCT full_name, ' | '), 60)) AS line
  FROM public.customers
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
  GROUP BY right(regexp_replace(phone, '\D', '', 'g'), 9)
  HAVING count(*) > 1
  LIMIT 40
),

-- ── 15. Actual source / status values ──────────────────────────────────────
-- leads.source has no CHECK constraint and importLeadsFromGoogleSheets writes
-- a sheet column verbatim, so the live value set is unknowable from code.
sec_source AS (
  SELECT 15 AS ord, row_number() OVER (ORDER BY count(*) DESC) AS sub,
         format('%-40s %s', COALESCE(source, '(null)'), count(*)) AS line
  FROM public.leads GROUP BY source
),
sec_utm AS (
  SELECT 16 AS ord, row_number() OVER (ORDER BY count(*) DESC) AS sub,
         format('%-40s %s', COALESCE(utm_source, '(null)'), count(*)) AS line
  FROM public.leads GROUP BY utm_source LIMIT 60
),
sec_status AS (
  -- Expect values outside the 27-item dropdown: 'won', 'qualified', service_*,
  -- delivery_inquiry*, and localStorage-born custom_* keys.
  SELECT 17 AS ord, row_number() OVER (ORDER BY count(*) DESC) AS sub,
         format('%-44s %s', COALESCE(status, '(null)'), count(*)) AS line
  FROM public.leads GROUP BY status
),

-- ── 18. Linkage: how many rows point at a lead, and how many already dangle ─
linkage(tbl, col) AS (
  VALUES ('quotes','lead_id'),('orders','lead_id'),('orders','customer_id'),
         ('support_tickets','lead_id'),('customers','lead_id'),
         ('sales_tasks','lead_id'),('call_logs','lead_id'),
         ('communication_logs','lead_id'),('upsell_suggestions','lead_id')
),
sec_link AS (
  SELECT 18 AS ord, row_number() OVER (ORDER BY l.tbl, l.col) AS sub,
         format('%-22s %-14s set=%-10s dangling=%s',
                l.tbl, l.col, COALESCE(r.n::text,'n/a'), COALESCE(r.d::text,'n/a')) AS line
  FROM linkage l
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN ok THEN (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM public.%I WHERE %I IS NOT NULL', l.tbl, l.col),
        false, true, '')))[1]::text::bigint END AS n,
      CASE WHEN ok AND l.col = 'lead_id' THEN (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM public.%I t WHERE t.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads x WHERE x.id = t.%I)', l.tbl, l.col, l.col),
        false, true, '')))[1]::text::bigint END AS d
    FROM (SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=l.tbl AND column_name=l.col
    ) AS ok) g
  ) r
),

-- ── 19. Preview/test contamination + the customers columns in doubt ────────
-- docs/improvement-plan.md records that preview deploys write real rows into
-- production and that they must be identified before handover.
-- Broken down by marker rather than one lump sum: a bare `phone LIKE
-- '%1234567%'` matches perfectly real numbers (0501234567 contains it) and
-- would wildly overstate the contamination.
sec_test AS (
  SELECT 19 AS ord, sub, format('%-34s %s', label, n) AS line
  FROM (
    SELECT 1 AS sub, 'name contains test/בדיקה' AS label,
           count(*) FILTER (WHERE full_name ILIKE '%test%' OR full_name ILIKE '%בדיקה%') AS n FROM public.leads
    UNION ALL
    SELECT 2, 'status = system_test',
           count(*) FILTER (WHERE status = 'system_test') FROM public.leads
    UNION ALL
    SELECT 3, 'phone is one repeated digit',
           count(*) FILTER (WHERE regexp_replace(COALESCE(phone,''), '\D', '', 'g') ~ '^(\d)\1{5,}$') FROM public.leads
    UNION ALL
    SELECT 4, 'phone too short to be real (<9)',
           count(*) FILTER (WHERE length(regexp_replace(COALESCE(phone,''), '\D', '', 'g')) BETWEEN 1 AND 8) FROM public.leads
    UNION ALL
    SELECT 5, 'phone empty/null',
           count(*) FILTER (WHERE phone IS NULL OR btrim(phone) = '') FROM public.leads
  ) t
),
sec_custcols AS (
  -- entities.js silently DROPS columns the DB lacks (PGRST204 handling), so a
  -- write to a non-existent column succeeds and vanishes. These are the ones
  -- the code writes but nothing reads back.
  SELECT 20 AS ord, row_number() OVER (ORDER BY w.col) AS sub,
         format('customers.%-18s %s', w.col,
                CASE WHEN c.column_name IS NULL THEN 'MISSING (writes are silently dropped)'
                     ELSE 'exists: ' || c.data_type END) AS line
  FROM (VALUES ('status'),('vip_status'),('source'),('original_source'),
               ('total_revenue'),('lifetime_value'),('total_orders'),
               ('lead_id'),('account_manager'),('phone_normalized')) w(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name='customers' AND c.column_name = w.col
),

headers(ord, title) AS (
  VALUES ( 1,'1. COLUMNS  (table / pos / column / type / null / default)'),
         ( 2,'2. FOREIGN KEYS → parent  [NO ACTION or RESTRICT means DELETE FROM leads FAILS]'),
         ( 3,'3. PK / UNIQUE / CHECK CONSTRAINTS'),
         ( 4,'4. INDEXES'),
         ( 5,'5. TRIGGERS  [must be disabled during bulk import]'),
         ( 6,'6. RLS ENABLED?'),
         ( 7,'7. RLS POLICIES'),
         ( 8,'8. TABLE GRANTS (anon / authenticated / service_role)'),
         ( 9,'9. VIEWS referencing leads/customers'),
         (10,'10. FUNCTIONS referencing leads'),
         (11,'11. ROW COUNTS'),
         (12,'12. PHONE FORMATS IN leads'),
         (13,'13. DUPLICATES CAUSED BY PHONE FORMATTING'),
         (14,'14. WORST DUPLICATE CUSTOMERS (top 40)'),
         (15,'15. leads.source VALUES'),
         (16,'16. leads.utm_source VALUES (top 60)'),
         (17,'17. leads.status VALUES'),
         (18,'18. LINKAGE + ALREADY-DANGLING POINTERS'),
         (19,'19. SUSPECTED PREVIEW/TEST DATA'),
         (20,'20. customers COLUMNS IN DOUBT')
),
body AS (
  SELECT * FROM sec_cols   UNION ALL SELECT * FROM sec_fk     UNION ALL
  SELECT * FROM sec_con    UNION ALL SELECT * FROM sec_idx    UNION ALL
  SELECT * FROM sec_trg    UNION ALL SELECT * FROM sec_rls    UNION ALL
  SELECT * FROM sec_pol    UNION ALL SELECT * FROM sec_grant  UNION ALL
  SELECT * FROM sec_view   UNION ALL SELECT * FROM sec_fn     UNION ALL
  SELECT * FROM sec_counts UNION ALL SELECT * FROM sec_fmt    UNION ALL
  SELECT * FROM sec_dup    UNION ALL SELECT * FROM sec_dupex  UNION ALL
  SELECT * FROM sec_source UNION ALL SELECT * FROM sec_utm    UNION ALL
  SELECT * FROM sec_status UNION ALL SELECT * FROM sec_link   UNION ALL
  SELECT * FROM sec_test   UNION ALL SELECT * FROM sec_custcols
),
combined AS (
  SELECT h.ord, 0 AS sub, '' AS line FROM headers h
  UNION ALL
  SELECT h.ord, 1, '=== ' || h.title FROM headers h
  UNION ALL
  SELECT b.ord, b.sub + 10, '    ' || b.line FROM body b
  UNION ALL
  -- Explicit "(none)" so an empty section reads as a finding, not an omission.
  SELECT h.ord, 9, '    (none)'
  FROM headers h
  WHERE NOT EXISTS (SELECT 1 FROM body b WHERE b.ord = h.ord)
)
SELECT line AS report
FROM combined
ORDER BY ord, sub;
