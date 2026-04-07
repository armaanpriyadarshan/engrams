import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SUPABASE_URL = "https://edrlhkcnkfsypdzffhle.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkcmxoa2Nua2ZzeXBkemZmaGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxOTQ5MjQsImV4cCI6MjA5MDc3MDkyNH0.q5NLwIdvlTxHvX-b8Asb6pH4lTLukI1S3s4V3_Vh0Xg";

const CONFIG_DIR = path.join(os.homedir(), ".engrams");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config {
  token: string;
  user_id?: string;
}

export function readConfig(): Config | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function clearConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  } catch {}
}

export function isLoggedIn(): boolean {
  const config = readConfig();
  return !!config?.token;
}

let client: SupabaseClient | null = null;
let verified = false;

export async function getSupabase(): Promise<SupabaseClient> {
  if (client && verified) return client;

  const config = readConfig();
  if (!config?.token) {
    throw new Error("NOT_LOGGED_IN");
  }

  client = createClient(SUPABASE_URL, ANON_KEY);

  // Verify token on first use
  if (!verified) {
    const { data, error } = await client.functions.invoke("mcp-auth", {
      body: { action: "verify-token", token: config.token },
    });

    if (error || !data?.valid) {
      clearConfig();
      throw new Error("TOKEN_EXPIRED");
    }

    verified = true;
  }

  return client;
}

export async function login(token: string): Promise<{ success: boolean; error?: string }> {
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await sb.functions.invoke("mcp-auth", {
    body: { action: "verify-token", token },
  });

  if (error || !data?.valid) {
    return { success: false, error: "Invalid token." };
  }

  saveConfig({ token, user_id: data.user_id });
  client = sb;
  verified = true;
  return { success: true };
}
