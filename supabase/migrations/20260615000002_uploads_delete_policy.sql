-- Allow authenticated staff to delete objects in the 'uploads' bucket, so that
-- removing a service-ticket photo/video inside the app also removes the
-- underlying file from Storage (no orphaned media). Mirrors the existing
-- authenticated write access to the same bucket.
--
-- Anonymous users intentionally get NO delete right: the public intake form
-- only drops removed files from the in-progress list (a customer can't delete
-- arbitrary objects), which keeps the anon surface minimal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated can delete uploads'
  ) THEN
    CREATE POLICY "Authenticated can delete uploads" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'uploads');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
