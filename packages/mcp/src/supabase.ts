import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.ENGRAMS_SUPABASE_URL;
  const key = process.env.ENGRAMS_SUPABASE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing ENGRAMS_SUPABASE_URL or ENGRAMS_SUPABASE_KEY environment variables. " +
      "Set these to your Supabase project URL and service role key."
    );
  }

  client = createClient(url, key);
  return client;
}
