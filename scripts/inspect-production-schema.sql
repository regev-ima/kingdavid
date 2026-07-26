-- ============================================================================
-- inspect-production-schema.sql  —  READ-ONLY production inventory
-- ============================================================================
-- WHY: the repo contains no CREATE TABLE for leads / customers / sales_tasks /
-- orders / quotes / sync_progress (base44-era tables), and 27 of 58 migrations
-- have no GitHub Actions workflow — so their application state is unknown.
-- Nothing about the live schema can be assumed from source control.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Then copy the FULL result of every block back.
--
-- SAFETY: every statement is a SELECT. No DDL, no DML, no locks beyond a
-- catalog read. Safe to run at any time, on production, during business hours.
-- ============================================================================


-- ─── 1. COLUMNS of the core tables ──────────────────────────────────────────
SELECT
  c.table_name,
  c.ordinal_position                                   AS pos,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
        'leads','customers','sales_tasks','orders','quotes',
        'communication_logs','call_logs','lead_activity_logs',
        'support_tickets','club_signups','sync_progress',
        'lead_counters','task_counters','dashboard_counters',
        'marketing_costs','upsell_suggestions',
        'whatsapp_chats','whatsapp_messages','whatsapp_message_logs'
      )
ORDER BY c.table_name, c.ordinal_position;


-- ─── 2. FOREIGN KEYS + their ON DELETE behaviour ────────────────────────────
-- THE decisive block: if quotes.lead_id / orders.lead_id carry a NO ACTION or
-- RESTRICT FK, `DELETE FROM leads` fails outright instead of orphaning rows.
SELECT
  con.conrelid::regclass::text                          AS child_table,
  con.conname                                           AS constraint_name,
  pg_get_constraintdef(con.oid)                         AS definition,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION (delete will FAIL)'
    WHEN 'r' THEN 'RESTRICT (delete will FAIL)'
    WHEN 'c' THEN 'CASCADE (children deleted too)'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END                                                   AS on_delete
FROM pg_constraint con
JOIN pg_class      rel ON rel.oid = con.confrelid
JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
WHERE con.contype = 'f'
  AND nsp.nspname = 'public'
  AND rel.relname IN ('leads','customers','sales_tasks','orders','quotes')
ORDER BY rel.relname, child_table;


-- ─── 3. UNIQUE / PRIMARY KEY / CHECK constraints ────────────────────────────
SELECT
  con.conrelid::regclass::text                          AS table_name,
  con.conname                                           AS constraint_name,
  CASE con.contype WHEN 'p' THEN 'PRIMARY KEY'
                   WHEN 'u' THEN 'UNIQUE'
                   WHEN 'c' THEN 'CHECK' END            AS kind,
  pg_get_constraintdef(con.oid)                         AS definition
FROM pg_constraint con
JOIN pg_class     rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND con.contype IN ('p','u','c')
  AND rel.relname IN ('leads','customers','sales_tasks','orders','quotes','club_signups')
ORDER BY rel.relname, con.contype;


-- ─── 4. INDEXES ─────────────────────────────────────────────────────────────
-- Confirms whether 20260428000001 (phone trigram) and the perf-index
-- migrations actually landed.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('leads','customers','sales_tasks','orders','quotes','support_tickets')
ORDER BY tablename, indexname;


-- ─── 5. TRIGGERS ────────────────────────────────────────────────────────────
-- Confirms whether the lead_activity_logs triggers and the
-- effective_sort_date default trigger exist. These must be disabled during
-- the bulk import (they double write volume and fire per row).
SELECT
  tgrelid::regclass::text                               AS table_name,
  tgname                                                AS trigger_name,
  pg_get_triggerdef(oid)                                AS definition
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid::regclass::text IN
      ('leads','customers','sales_tasks','orders','quotes')
ORDER BY table_name, trigger_name;


-- ─── 6. RLS state + policies ────────────────────────────────────────────────
-- 20240202000001 used `CREATE POLICY IF NOT EXISTS`, which is invalid
-- PostgreSQL — so it may have enabled RLS without ever creating policies,
-- which would lock these tables to every non-service-role client.
SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN ('leads','customers','sales_tasks','orders','quotes','club_signups')
ORDER BY relname;

SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('leads','customers','sales_tasks','orders','quotes')
ORDER BY tablename, policyname;


-- ─── 7. TABLE-LEVEL GRANTS ──────────────────────────────────────────────────
-- No GRANT on any of these tables exists in any migration, so the effective
-- privileges of anon / authenticated are whatever the project defaults are.
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated','service_role')
  AND table_name IN ('leads','customers','sales_tasks','orders','quotes')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;


-- ─── 8. VIEWS / FUNCTIONS that read leads or customers ──────────────────────
-- These must be re-pointed or re-created after the restructure. rep_stats in
-- particular is queried by /Representatives but has no definition in the repo.
SELECT table_name AS view_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND (view_definition ILIKE '%public.leads%' OR view_definition ILIKE '%public.customers%'
       OR view_definition ILIKE '% leads %'   OR view_definition ILIKE '% customers %')
ORDER BY table_name;

SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%leads%'
ORDER BY p.proname;


-- ============================================================================
-- DATA REALITY CHECKS — the numbers that decide the migration strategy
-- ============================================================================

-- ─── 9. Row counts ──────────────────────────────────────────────────────────
SELECT 'leads' AS t, count(*) FROM public.leads
UNION ALL SELECT 'sales_tasks',        count(*) FROM public.sales_tasks
UNION ALL SELECT 'customers',          count(*) FROM public.customers
UNION ALL SELECT 'quotes',             count(*) FROM public.quotes
UNION ALL SELECT 'orders',             count(*) FROM public.orders
UNION ALL SELECT 'lead_activity_logs', count(*) FROM public.lead_activity_logs
UNION ALL SELECT 'communication_logs', count(*) FROM public.communication_logs
UNION ALL SELECT 'call_logs',          count(*) FROM public.call_logs
UNION ALL SELECT 'support_tickets',    count(*) FROM public.support_tickets
UNION ALL SELECT 'club_signups',       count(*) FROM public.club_signups;


-- ─── 10. Phone format spread — the duplicate problem, quantified ────────────
SELECT
  CASE
    WHEN phone IS NULL OR btrim(phone) = ''            THEN 'empty'
    WHEN phone ~ '^0\d{9}$'                            THEN 'local, no separators  (0501234567)'
    WHEN phone ~ '^0\d{8}$'                            THEN 'local landline        (031234567)'
    WHEN phone ~ '^0\d{1,2}-\d{7,8}$'                  THEN 'local with hyphen      (050-1234567)'
    WHEN phone ~ '^\+?972'                             THEN 'international          (+972.. / 972..)'
    WHEN phone ~ '[^0-9+\- ()]'                        THEN 'contains letters/junk'
    ELSE                                                    'other'
  END                                                  AS format,
  count(*)                                             AS rows
FROM public.leads
GROUP BY 1
ORDER BY rows DESC;


-- ─── 11. How many duplicate people are hiding behind format differences ─────
-- Normalizes to the last 9 digits and counts collisions. The gap between
-- "distinct raw phones" and "distinct normalized phones" IS the duplicate count.
WITH n AS (
  SELECT right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) AS key, phone
  FROM public.leads
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
)
SELECT
  count(*)                                             AS total_leads_with_phone,
  count(DISTINCT phone)                                AS distinct_raw_phones,
  count(DISTINCT key) FILTER (WHERE length(key) = 9)   AS distinct_normalized_phones,
  count(DISTINCT phone) - count(DISTINCT key) FILTER (WHERE length(key) = 9)
                                                       AS duplicates_caused_by_formatting
FROM n;

-- Same question for customers — these are the duplicate CUSTOMER rows.
WITH n AS (
  SELECT right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) AS key
  FROM public.customers
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
)
SELECT count(*) AS customers_with_phone,
       count(DISTINCT key) AS distinct_normalized,
       count(*) - count(DISTINCT key) AS duplicate_customer_rows
FROM n;

-- The worst offenders, so you can eyeball that the merge rule is right.
SELECT right(regexp_replace(phone, '\D', '', 'g'), 9) AS normalized_tail,
       count(*)                                       AS customer_rows,
       string_agg(DISTINCT phone, ' | ')              AS raw_variants,
       string_agg(DISTINCT full_name, ' | ')          AS names
FROM public.customers
WHERE phone IS NOT NULL AND btrim(phone) <> ''
GROUP BY 1
HAVING count(*) > 1
ORDER BY customer_rows DESC
LIMIT 40;


-- ─── 12. Actual source values in production ─────────────────────────────────
-- leads.source is free text with no CHECK, so the live value set is unknowable
-- from code. This is what the canonical taxonomy has to absorb.
SELECT coalesce(source, '(null)') AS source, count(*) AS rows
FROM public.leads GROUP BY 1 ORDER BY rows DESC;

SELECT coalesce(utm_source, '(null)') AS utm_source, count(*) AS rows
FROM public.leads GROUP BY 1 ORDER BY rows DESC LIMIT 60;

SELECT coalesce(landing_page, '(null)') AS landing_page, count(*) AS rows
FROM public.leads GROUP BY 1 ORDER BY rows DESC LIMIT 60;


-- ─── 13. Actual status values in production ─────────────────────────────────
-- Expect values outside the 27-item dropdown: 'won', 'qualified', service_*,
-- delivery_inquiry*, and localStorage-born custom_* keys.
SELECT coalesce(status, '(null)') AS status, count(*) AS rows
FROM public.leads GROUP BY 1 ORDER BY rows DESC;


-- ─── 14. Orphan / linkage reality ───────────────────────────────────────────
SELECT 'quotes with lead_id'          AS what, count(*) FROM public.quotes         WHERE lead_id     IS NOT NULL
UNION ALL SELECT 'orders with lead_id',       count(*) FROM public.orders          WHERE lead_id     IS NOT NULL
UNION ALL SELECT 'orders with customer_id',   count(*) FROM public.orders          WHERE customer_id IS NOT NULL
UNION ALL SELECT 'tickets with lead_id',      count(*) FROM public.support_tickets WHERE lead_id     IS NOT NULL
UNION ALL SELECT 'customers with lead_id',    count(*) FROM public.customers       WHERE lead_id     IS NOT NULL
UNION ALL SELECT 'tasks with lead_id',        count(*) FROM public.sales_tasks     WHERE lead_id     IS NOT NULL;

-- Already-broken pointers today (before we delete anything).
SELECT 'quotes → missing lead'  AS what, count(*) FROM public.quotes q
  WHERE q.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = q.lead_id)
UNION ALL
SELECT 'orders → missing lead',        count(*) FROM public.orders o
  WHERE o.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = o.lead_id)
UNION ALL
SELECT 'tasks → missing lead',         count(*) FROM public.sales_tasks t
  WHERE t.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = t.lead_id);


-- ─── 15. How many leads look like preview/test data ─────────────────────────
-- docs/improvement-plan.md records that preview deployments have been writing
-- real rows into production. This tells us how much of the 104k is noise.
SELECT count(*) AS suspected_test_leads
FROM public.leads
WHERE full_name ILIKE '%test%' OR full_name ILIKE '%בדיקה%'
   OR phone LIKE '%1234567%'   OR phone LIKE '%0000000%'
   OR status = 'system_test';


-- ─── 16. Does customers.status / vip_status actually exist? ─────────────────
-- entities.js silently DROPS columns the DB doesn't have (PGRST204 handling),
-- so writes to a non-existent column succeed and vanish.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers'
  AND column_name IN ('status','vip_status','source','original_source',
                      'total_revenue','lifetime_value','total_orders','lead_id');

-- ============================================================================
-- END. Copy the full output of all 16 blocks back.
-- ============================================================================
