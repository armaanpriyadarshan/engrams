import type { createClient } from "@/lib/supabase/client"

/**
 * Fire-and-forget side effects that run after a successful compilation:
 * re-index embeddings, detect knowledge gaps, and lint the engram.
 */
export function runPostCompile(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  sourceId?: string,
) {
  supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
  supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: sourceId } })
  supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
}
