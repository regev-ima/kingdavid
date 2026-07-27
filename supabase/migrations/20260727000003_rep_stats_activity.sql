-- ============================================================================
-- rep_stats — into git, plus a real "last activity" column
-- ============================================================================
-- Two problems, one file.
--
-- 1. public.rep_stats is not in this repository. It is referenced by comments
--    in three migrations and queried directly by pages/Representatives.jsx, but
--    its definition was only ever created straight against the database. Any
--    rebuild from migrations produces a database where the reps page 500s.
--    This file puts it under version control.
--
-- 2. The page's "last sign in" column answers the wrong question. Production
--    shows 7 of 36 reps with a last_sign_in_at and the rest NULL — and the
--    diagnosis came back clean, no broken auth_id links, so those NULLs are
--    real: those people have accounts and have genuinely never signed in.
--    But the converse is the actual trap: a rep who stays signed in works for
--    weeks while their token silently refreshes, and last_sign_in_at never
--    moves. "Signed in" is not "used the system".
--    last_activity_at is derived from what reps actually DO.
--
-- Column contract — pages/Representatives.jsx getRepStats() reads exactly:
--   email, total_leads, active_leads, closed_won, closed_lost, last_sign_in_at
-- All six are preserved verbatim. last_activity_at is added; nothing is
-- removed, so this cannot break the page.
--
-- Why the activity sources are discovered instead of hardcoded: neither
-- communication_logs nor call_logs has a CREATE TABLE anywhere in this repo
-- either, so their column names cannot be read from source. The DO block below
-- probes information_schema for a user column and a timestamp column from a
-- documented candidate list, RAISE NOTICEs what it picked, and skips any table
-- it cannot make sense of. A missing or unrecognised source costs one signal,
-- never a failed migration.
-- ============================================================================

BEGIN;

-- Lead status semantics, mirroring src/constants/leadOptions.js. 'deal_closed'
-- is the single win; the rest of CLOSED_STATUSES are losses; anything else is
-- still active. Kept as a function so the view stays readable and the list
-- lives in exactly one place here.
CREATE OR REPLACE FUNCTION public.lead_closed_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'deal_closed', 'not_relevant_duplicate', 'mailing_remove_request',
    'lives_far_phone_concern', 'products_not_available',
    'not_relevant_bought_elsewhere', 'not_relevant_1000_nis',
    'not_relevant_denies_contact', 'not_relevant_service',
    'not_interested_hangs_up', 'not_relevant_no_explanation',
    'heard_price_not_interested', 'not_relevant_wrong_number',
    'closed_by_manager_to_mailing'
  ]::text[];
$$;

DO $build$
DECLARE
  -- Ordered by preference: the first name found in a table wins.
  user_cands text[] := ARRAY['performed_by','created_by','user_email','rep_email',
                             'rep','agent_email','user_id','created_by_id'];
  time_cands text[] := ARRAY['created_date','created_at','call_time','msg_timestamp',
                             'started_at','start_time','timestamp'];
  tbl        text;
  user_col   text;
  user_type  text;
  time_col   text;
  email_expr text;
  parts      text[] := ARRAY[]::text[];
  chosen     text[] := ARRAY[]::text[];
  activity   text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['lead_activity_logs','communication_logs','call_logs']
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'rep_activity: table % absent, skipping', tbl;
      CONTINUE;
    END IF;

    SELECT c.column_name, c.data_type INTO user_col, user_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = tbl
      AND c.column_name = ANY (user_cands)
    ORDER BY array_position(user_cands, c.column_name)
    LIMIT 1;

    SELECT c.column_name INTO time_col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = tbl
      AND c.column_name = ANY (time_cands)
    ORDER BY array_position(time_cands, c.column_name)
    LIMIT 1;

    IF user_col IS NULL OR time_col IS NULL THEN
      RAISE NOTICE 'rep_activity: % has no recognised user/time column (user=%, time=%), skipping',
                   tbl, coalesce(user_col,'-'), coalesce(time_col,'-');
      CONTINUE;
    END IF;

    -- The user column is an email on some tables and a users.id uuid on others.
    -- Normalise both to a lowercase email so the sources can be unioned.
    IF user_type = 'uuid' THEN
      email_expr := format(
        '(SELECT lower(u2.email) FROM public.users u2 WHERE u2.id = t.%I)', user_col);
    ELSE
      email_expr := format('lower(nullif(btrim(t.%I::text), %L))', user_col, '');
    END IF;

    parts := parts || format(
      'SELECT %s AS email, max(t.%I) AS last_at FROM public.%I t WHERE t.%I IS NOT NULL GROUP BY 1',
      email_expr, time_col, tbl, user_col);

    chosen := chosen || format('%s(user=%s,time=%s)', tbl, user_col, time_col);
    RAISE NOTICE 'rep_activity: using % (user=% [%], time=%)', tbl, user_col, user_type, time_col;
  END LOOP;

  IF array_length(parts, 1) IS NULL THEN
    RAISE NOTICE 'rep_activity: no usable sources found — last_activity_at will be NULL';
    activity := 'SELECT NULL::text AS email, NULL::timestamptz AS last_at WHERE false';
  ELSE
    activity := array_to_string(parts, ' UNION ALL ');
  END IF;

  PERFORM set_config('rep_stats.sources', chosen::text, false);

  -- DROP then CREATE, not CREATE OR REPLACE. Replace refuses to reorder or
  -- rename existing columns, and the rep_stats already in production has a
  -- different column order than this definition — it failed with
  -- "cannot change name of view column last_sign_in_at to total_leads".
  -- Deliberately no CASCADE: if some other object depends on this view, the
  -- migration should stop and say so rather than quietly dropping it. The
  -- whole file is one transaction, so the view is never missing to readers.
  EXECUTE 'DROP VIEW IF EXISTS public.rep_stats';

  EXECUTE format($view$
    CREATE VIEW public.rep_stats AS
    WITH activity AS (
      SELECT email, max(last_at) AS last_activity_at
      FROM ( %s ) s
      WHERE email IS NOT NULL
      GROUP BY email
    ),
    lead_agg AS (
      SELECT lower(rep) AS email,
             count(*)                                                    AS total_leads,
             count(*) FILTER (WHERE NOT (status = ANY (public.lead_closed_statuses()))) AS active_leads,
             count(*) FILTER (WHERE status = 'deal_closed')              AS closed_won,
             count(*) FILTER (WHERE status = ANY (public.lead_closed_statuses())
                                AND status <> 'deal_closed')             AS closed_lost
      FROM (
        -- A lead counts for its primary AND secondary rep, matching how the
        -- app filters (rep1 OR rep2) everywhere else.
        SELECT rep1 AS rep, status FROM public.leads WHERE nullif(btrim(rep1), '') IS NOT NULL
        UNION ALL
        SELECT rep2 AS rep, status FROM public.leads WHERE nullif(btrim(rep2), '') IS NOT NULL
      ) r
      GROUP BY 1
    )
    SELECT
      u.email,
      coalesce(l.total_leads,  0)::bigint AS total_leads,
      coalesce(l.active_leads, 0)::bigint AS active_leads,
      coalesce(l.closed_won,   0)::bigint AS closed_won,
      coalesce(l.closed_lost,  0)::bigint AS closed_lost,
      a.last_sign_in_at,
      act.last_activity_at
    FROM public.users u
    -- Prefer the auth_id link; fall back to email so a profile whose auth_id
    -- was never linked still resolves, exactly like resolveUserProfile does.
    -- LATERAL rather than a plain join so a user matching two auth rows yields
    -- one row here instead of silently duplicating the rep.
    LEFT JOIN LATERAL (
      SELECT au.last_sign_in_at
      FROM auth.users au
      WHERE au.id = u.auth_id OR lower(au.email) = lower(u.email)
      ORDER BY (au.id = u.auth_id) DESC NULLS LAST, au.last_sign_in_at DESC NULLS LAST
      LIMIT 1
    ) a ON true
    LEFT JOIN lead_agg l  ON l.email   = lower(u.email)
    LEFT JOIN activity act ON act.email = lower(u.email)
  $view$, activity);
END
$build$;

-- Record which sources were actually chosen, in the view comment. The
-- Management API used to apply these migrations returns only a bare result and
-- swallows RAISE NOTICE, so without this the discovery above would be a black
-- box in production — exactly where knowing matters. Query it with:
--   SELECT obj_description('public.rep_stats'::regclass);
DO $doc$
DECLARE note text;
BEGIN
  SELECT coalesce(nullif(array_to_string(sources, ', '), ''), 'NONE — last_activity_at is NULL')
  INTO note
  FROM (SELECT current_setting('rep_stats.sources', true)::text[] AS sources) q;

  EXECUTE format(
    'COMMENT ON VIEW public.rep_stats IS %L',
    'Per-rep lead counts, last_sign_in_at (auth) and last_activity_at. '
    'Defined in migration 20260727000003. Activity sources: ' || note);
EXCEPTION WHEN others THEN
  EXECUTE 'COMMENT ON VIEW public.rep_stats IS ''Per-rep lead counts and activity. Migration 20260727000003.''';
END
$doc$;

-- The view reads auth.users, so it must run with the owner''s rights rather
-- than the caller''s — security_invoker stays off (the default). The
-- Representatives page that consumes it is admin-gated in the app.
GRANT SELECT ON public.rep_stats TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
