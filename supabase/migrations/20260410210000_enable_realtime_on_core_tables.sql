-- Add core engram tables to the supabase_realtime publication so the map,
-- source tree, and sidebar can subscribe to INSERT/UPDATE/DELETE events.
--
-- Historically only compilation_runs was published, which meant the map
-- only refreshed at the end of compile cycles and user-initiated deletes
-- never propagated. Adding these tables enables live reconcile on the
-- animated map flow.
--
-- Idempotent: guarded by a lookup against pg_publication_tables so this
-- can be re-run safely against a database that already has the tables.

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
  END LOOP;
END $$;
