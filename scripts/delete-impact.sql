-- ============================================================================
-- Blast radius — what a lead wipe would actually destroy
-- ============================================================================
-- status-check.sql row 8 reported six foreign keys blocking DELETE FROM leads:
-- sales_tasks, quotes, orders, call_logs, whatsapp_message_logs,
-- communication_logs. Those are not bookkeeping tables — they are orders,
-- price quotes and call history. Before anyone decides how to wipe, the
-- question is how much of that is attached to a lead at all.
--
-- Read-only. Discovers the FK set live rather than trusting the hardcoded
-- list, so it stays correct as the schema moves, and reports for each child
-- table: how many of its rows point at a lead, and how many distinct leads
-- those rows cover.
-- ============================================================================

-- Plain temp table, not ON COMMIT DROP: when these statements are sent
-- individually (psql, or a client that does not wrap the file in one
-- transaction) an ON COMMIT DROP table disappears at the first statement
-- boundary and everything after it fails on a missing relation. This lives
-- until the session ends instead.
DROP TABLE IF EXISTS _impact;
CREATE TEMP TABLE _impact (
  ord            integer,
  child_table    text,
  fk_column      text,
  on_delete      text,
  child_rows     bigint,
  leads_affected bigint
);

DO $$
DECLARE
  r          record;
  n_rows     bigint;
  n_leads    bigint;
  i          integer := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text          AS child_table,
           a.attname::text                     AS fk_column,
           CASE c.confdeltype WHEN 'a' THEN 'NO ACTION (blocks)'
                              WHEN 'r' THEN 'RESTRICT (blocks)'
                              WHEN 'c' THEN 'CASCADE (deletes child)'
                              WHEN 'n' THEN 'SET NULL (orphans child)'
                              WHEN 'd' THEN 'SET DEFAULT'
                              ELSE c.confdeltype::text END AS on_delete
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.leads'::regclass
    ORDER BY 1
  LOOP
    i := i + 1;
    EXECUTE format(
      'SELECT count(*), count(DISTINCT %I) FROM %s WHERE %I IS NOT NULL',
      r.fk_column, r.child_table, r.fk_column)
      INTO n_rows, n_leads;

    INSERT INTO _impact
    VALUES (i, r.child_table, r.fk_column, r.on_delete, n_rows, n_leads);
  END LOOP;
END
$$;

-- How many leads are entangled at all, across every child table at once. This
-- is the number that decides the strategy: if it is small, the untouched leads
-- can be deleted and only the entangled ones matched in place.
--
-- Built from the FK set discovered above rather than a hardcoded table list —
-- the six names are today's answer, not a guarantee, and a stale list here
-- would silently undercount exactly the rows this is meant to protect.
DO $$
DECLARE
  parts text;
  total bigint;
BEGIN
  SELECT string_agg(
           format('SELECT 1 FROM %s x WHERE x.%I = l.id', child_table, fk_column),
           ' UNION ALL ')
  INTO parts
  FROM _impact WHERE ord < 99;

  IF parts IS NULL THEN
    total := 0;
  ELSE
    EXECUTE format(
      'SELECT count(*) FROM public.leads l WHERE EXISTS (%s)', parts)
      INTO total;
  END IF;

  INSERT INTO _impact
  VALUES (99, '— TOTAL leads with any child row —', '', '', NULL, total);
END
$$;

SELECT ord AS "#",
       child_table    AS "טבלה",
       fk_column      AS "עמודה",
       on_delete      AS "התנהגות במחיקה",
       child_rows     AS "שורות",
       leads_affected AS "לידים מושפעים"
FROM _impact ORDER BY ord;
