import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Batch embeddings in chunks to keep well under the OpenAI per-request
// token budget. text-embedding-3-small accepts ~300k tokens per request,
// but we trim each article's content_md to 6000 chars which is ~1500
// tokens; a batch of 32 articles is a safe ceiling that leaves plenty
// of headroom for title + summary.
const EMBED_BATCH_SIZE = 32

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
  let agentRunId: string | null = null
  const startedAt = Date.now()

  // NOTE: do NOT use `.catch(() => {})` on supabase query builders here —
  // it breaks the await chain in Deno edge runtime, silently killing the
  // request and causing the worker to exit mid-write. Destructure `error`
  // from the awaited result instead. This is the same pattern compile-source
  // uses and for the same reason.
  const finishRun = async (
    status: "completed" | "failed",
    summary: string,
    detail: Record<string, unknown> = {},
  ) => {
    if (!agentRunId) return
    const { error } = await supabase.from("agent_runs").update({
      status,
      summary: summary.slice(0, 300),
      detail,
      duration_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    }).eq("id", agentRunId)
    if (error) console.error("[generate-embedding] finishRun update error", error)
  }

  try {
    const body = await req.json()
    const { engram_id, article_slugs } = body

    if (!engram_id) {
      return new Response(JSON.stringify({ error: "engram_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: openaiKey } = await supabase.rpc("get_openai_key")
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Insert running row
    const { data: runRow } = await supabase
      .from("agent_runs")
      .insert({ engram_id, agent_type: "embed", status: "running" })
      .select("id")
      .single()
    agentRunId = runRow?.id ?? null

    // Fetch articles that need embedding
    let query = supabase
      .from("articles")
      .select("slug, title, summary, content_md")
      .eq("engram_id", engram_id)

    if (article_slugs && article_slugs.length > 0) {
      // Specific articles (after compilation)
      query = query.in("slug", article_slugs)
    } else {
      // Backfill: all articles without embeddings
      query = query.is("embedding", null)
    }

    const { data: articles, error: fetchErr } = await query
    if (fetchErr) {
      await finishRun("failed", "Could not fetch articles", { error: fetchErr.message })
      return new Response(JSON.stringify({ error: "Could not fetch articles", detail: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (!articles || articles.length === 0) {
      await finishRun("completed", "Already up to date.", { embedded: 0 })
      return new Response(JSON.stringify({ embedded: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Process in batches so a single huge engram doesn't blow the token
    // budget on one request.
    let embedded = 0
    for (let start = 0; start < articles.length; start += EMBED_BATCH_SIZE) {
      const batch = articles.slice(start, start + EMBED_BATCH_SIZE)
      const texts = batch.map((a: { title: string; summary: string | null; content_md: string | null }) => {
        const parts = [a.title]
        if (a.summary) parts.push(a.summary)
        if (a.content_md) parts.push(a.content_md.slice(0, 6000))
        return parts.join("\n\n")
      })

      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: texts,
        }),
      })

      if (!embRes.ok) {
        const err = await embRes.text()
        await finishRun("failed", "Embedding API failed", { error: err.slice(0, 500), batch_start: start })
        return new Response(JSON.stringify({ error: "Embedding API failed", detail: err }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const embData = await embRes.json()

      // Update each article with its embedding
      for (let i = 0; i < batch.length; i++) {
        const embedding = embData.data[i].embedding
        const { error: updateErr } = await supabase
          .from("articles")
          .update({ embedding })
          .eq("engram_id", engram_id)
          .eq("slug", batch[i].slug)

        if (updateErr) {
          console.error("[generate-embedding] article update error", batch[i].slug, updateErr)
        } else {
          embedded++
        }
      }
    }

    const summary = embedded === 1
      ? "1 embedding written."
      : `${embedded} embeddings written.`
    await finishRun("completed", summary, { embedded, total: articles.length })

    return new Response(JSON.stringify({ embedded }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    await finishRun("failed", String(err).slice(0, 300), { error: String(err) })
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
