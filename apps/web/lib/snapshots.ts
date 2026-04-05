import { SupabaseClient } from "@supabase/supabase-js"

export async function createSnapshot(
  supabase: SupabaseClient,
  engramId: string,
  triggerType: "feed" | "query_fileback" | "agent" | "rollback" | "manual",
  summary: string,
  diff: Record<string, unknown> = {},
  triggerId?: string,
) {
  // Get current snapshot number
  const { data: latest } = await supabase
    .from("engram_snapshots")
    .select("snapshot_number")
    .eq("engram_id", engramId)
    .order("snapshot_number", { ascending: false })
    .limit(1)
    .single()

  const snapshotNumber = (latest?.snapshot_number ?? 0) + 1

  // Capture current state
  const [articlesRes, edgesRes, sourcesRes] = await Promise.all([
    supabase.from("articles").select("*").eq("engram_id", engramId),
    supabase.from("edges").select("*").eq("engram_id", engramId),
    supabase.from("sources").select("*").eq("engram_id", engramId),
  ])

  const data = {
    articles: articlesRes.data ?? [],
    edges: edgesRes.data ?? [],
    sources: sourcesRes.data ?? [],
  }

  await supabase.from("engram_snapshots").insert({
    engram_id: engramId,
    snapshot_number: snapshotNumber,
    trigger_type: triggerType,
    trigger_id: triggerId ?? null,
    summary,
    data,
    diff,
  })
}
