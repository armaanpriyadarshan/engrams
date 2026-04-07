import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let userId: string | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (client) return client;

  const url = process.env.ENGRAMS_SUPABASE_URL;
  const token = process.env.ENGRAMS_API_TOKEN;
  const key = process.env.ENGRAMS_SUPABASE_KEY; // legacy: service role key

  if (!url) {
    throw new Error(
      "Missing ENGRAMS_SUPABASE_URL. Set this to your Supabase project URL.\n" +
      "Get your token at: https://engrams-ai.vercel.app/auth/mcp"
    );
  }

  if (!token && !key) {
    throw new Error(
      "Missing ENGRAMS_API_TOKEN. Get your token at: https://engrams-ai.vercel.app/auth/mcp\n" +
      "Then set: export ENGRAMS_API_TOKEN=eng_your_token_here"
    );
  }

  if (key) {
    // Legacy: direct service role key access
    client = createClient(url, key);
    return client;
  }

  // Token-based auth: verify token and get user_id, then use service role via edge function
  // For now, we use the anon key and pass the token for verification
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkcmxoa2Nua2ZzeXBkemZmaGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxOTQ5MjQsImV4cCI6MjA5MDc3MDkyNH0.q5NLwIdvlTxHvX-b8Asb6pH4lTLukI1S3s4V3_Vh0Xg";

  client = createClient(url, anonKey);

  // Verify the API token
  const { data, error } = await client.functions.invoke("mcp-auth", {
    body: { action: "verify-token", token },
  });

  if (error || !data?.valid) {
    throw new Error(
      "Invalid API token. Generate a new one at: https://engrams-ai.vercel.app/auth/mcp"
    );
  }

  userId = data.user_id;
  return client;
}

export function getUserId(): string | null {
  return userId;
}
