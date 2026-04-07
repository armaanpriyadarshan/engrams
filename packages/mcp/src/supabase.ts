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
  service_key?: string;
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
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
let currentUserId: string | null = null;
let verified = false;

export async function getSupabase(): Promise<SupabaseClient> {
  if (client && verified) return client;

  const config = readConfig();
  if (!config?.token) {
    throw new Error("NOT_LOGGED_IN");
  }

  // If we have a cached service key, use it directly
  if (config.service_key && config.user_id) {
    client = createClient(SUPABASE_URL, config.service_key);
    currentUserId = config.user_id;
    verified = true;
    return client;
  }

  // Otherwise verify token and get service key
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await anonClient.functions.invoke("mcp-auth", {
    body: { action: "verify-token", token: config.token },
  });

  if (error || !data?.valid) {
    clearConfig();
    throw new Error("TOKEN_EXPIRED");
  }

  // Save service key for future use
  saveConfig({ ...config, user_id: data.user_id, service_key: data.service_key });

  client = createClient(SUPABASE_URL, data.service_key);
  currentUserId = data.user_id;
  verified = true;
  return client;
}

export function getUserId(): string | null {
  return currentUserId;
}

export async function login(token: string): Promise<{ success: boolean; error?: string }> {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await anonClient.functions.invoke("mcp-auth", {
    body: { action: "verify-token", token },
  });

  if (error || !data?.valid) {
    return { success: false, error: "Invalid token." };
  }

  saveConfig({ token, user_id: data.user_id, service_key: data.service_key });
  client = createClient(SUPABASE_URL, data.service_key);
  currentUserId = data.user_id;
  verified = true;
  return { success: true };
}
