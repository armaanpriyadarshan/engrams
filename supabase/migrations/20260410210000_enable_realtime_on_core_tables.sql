-- Enable realtime for the core engram tables so the map, source tree,
-- and sidebar can subscribe to INSERT/UPDATE/DELETE events.
--
-- Two changes are needed per table:
--
-- 1. Publication membership — historically only compilation_runs was in
--    supabase_realtime, so article/edge/source/engram changes emitted no
--    events at all. That meant the map only refreshed on compile-complete
--    and user-initiated deletions never propagated.
--
-- 2. REPLICA IDENTITY FULL — with the default (PK-only) replica identity,
--    DELETE events only expose the primary key in the OLD row. Supabase
--    Realtime filters like `engram_id=eq.X` then fail to match DELETE
--    events because engram_id isn't present, and subscribers never see
--    the delete. FULL replicates every column so filters match.
--
-- Idempotent: safe to re-run against a DB that's already configured.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['articles', 'edges', 'sources', 'engrams']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;
