-- One person, one rep slot.
--
-- A lead, a customer and an order each carry a primary rep (rep1, or
-- account_manager on a customer) and a secondary (rep2). Nothing stopped the
-- same person from holding both, and when that happens the record is locked to
-- them: two handling slots spent on one rep, so nobody else can be added — and
-- on an order it reads as one rep splitting commission with themselves.
--
-- Most of these were not mis-clicks. Transferring one rep's book to another
-- (processTransferBatch) rewrites every rep field from the old email to the
-- new one, so transferring A → B over a record with rep1=A, rep2=B produced
-- the duplicate silently and in bulk. That path, the bulk-update runner and the
-- rep pickers all enforce the rule from now on; this clears what they left
-- behind.
--
-- Clearing rep2 loses nothing: it holds a copy of a value the row already
-- carries in its primary column.
--
-- Comparison is trimmed + case-folded, the same way the app compares rep
-- emails (isSameRep in src/lib/repSlots.js), so " Rep@x.co.il " and
-- "rep@x.co.il" count as the same person here too.
--
-- Guarded on the column existing, per table: the repo has no CREATE TABLE for
-- these base44-era tables (see scripts/fixtures/schema-approximation.sql), and
-- `rep2` is a certainty only on `leads`. A table that doesn't carry the column
-- has nothing to repair, and must not fail the migration for the ones that do.
--
-- Deliberately NOT a CHECK constraint. A constraint would turn any write path
-- we haven't covered into a hard failure for the user mid-save — on a table
-- where the save is a lead, an order or a payment. The rule is enforced where
-- the writes happen, and this migration is re-runnable as a repair.
--
-- Idempotent: a second run matches nothing.

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('leads',     'rep1'),
      ('customers', 'account_manager'),
      ('orders',    'rep1')
    ) AS t(table_name, primary_column)
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = pair.table_name
         AND column_name = 'rep2'
    );
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = pair.table_name
         AND column_name = pair.primary_column
    );

    EXECUTE format(
      'UPDATE public.%I
          SET rep2 = NULL
        WHERE %I IS NOT NULL
          AND rep2 IS NOT NULL
          AND lower(btrim(%I)) <> %L
          AND lower(btrim(%I)) = lower(btrim(rep2))',
      pair.table_name,
      pair.primary_column,
      pair.primary_column, '',
      pair.primary_column
    );

    RAISE NOTICE 'rep slots repaired on %', pair.table_name;
  END LOOP;
END $$;
