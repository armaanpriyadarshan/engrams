// Hybrid search edge function.
//
// Embeds the user's query via text-embedding-3-small, then calls the
// match_articles_hybrid RPC which fuses BM25 + pgvector cosine rankings
// via Reciprocal Rank Fusion inside Postgres. Tag AND-filter and tag/
// recency boosts are applied in-RPC so the edge function stays thin.
//
// Request shape:
//   {
//     engram_id: uuid,
//     query: string,
//     limit?: number = 10,
//     filter_tags?: string[],   // AND filter
//     boost_tags?: string[]     // rank boost
//   }
//
// Response shape:
//   {
//     results: Array<{
//       slug, title, summary, confidence, article_type,
//       tags, updated_at, bm25_rank, vector_rank, rrf_score
//     }>,
//     embedded: boolean   // false when the embedding step was skipped
//                         // (e.g. OPENAI_API_KEY missing) — caller knows
//                         // the ranking is BM25-only
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface HybridSearchRequest {
  engram_id: string
  query: string
  limit?: number
  filter_tags?: string[]
  boost_tags?: string[]
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as HybridSearchRequest
    const { engram_id, query, limit = 10, filter_tags, boost_tags } = body

    if (!engram_id || !query || !query.trim()) {
      return json({ error: "engram_id and query are required" }, 400)
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // Try to embed. If the key is missing or the call fails, fall back to
    // BM25-only by passing a zero vector — the RPC will simply return zero
    // hits from the vector CTE and RRF will use BM25 ranks only.
    let embedding: number[] | null = null
    let embedded = false

    const { data: openaiKey } = await supabase.rpc("get_openai_key")
    if (openaiKey) {
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: query,
        }),
      })
      if (embRes.ok) {
        const embData = await embRes.json()
        embedding = embData.data?.[0]?.embedding ?? null
        embedded = embedding !== null
      }
    }

    // pgvector requires a vector of the right dimensions even when we
    // want the vector CTE to contribute nothing. Use a zero vector
    // of 1536 dims — cosine distance to anything is undefined (NaN),
    // so we'll catch this below by passing a sentinel vector that
    // produces stable ordering (all identical distances, which in
    // practice means vector rank is arbitrary). Cheaper path: when
    // there's no embedding, only call BM25.
    let results
    if (embedded && embedding) {
      const { data, error } = await supabase.rpc("match_articles_hybrid", {
        query_text: query,
        query_embedding: embedding,
        match_engram_id: engram_id,
        match_count: limit,
        filter_tags: filter_tags ?? null,
        boost_tags: boost_tags ?? null,
      })
      if (error) {
        return json({ error: "Search failed", detail: error.message }, 500)
      }
      results = data ?? []
    } else {
      // BM25-only fallback path using the websearch_to_tsquery parser
      // plus tag AND-filter. Same return shape (vector_rank = 0).
      const { data, error } = await supabase.rpc("match_articles_bm25", {
        query_text: query,
        match_engram_id: engram_id,
        match_count: limit,
        filter_tags: filter_tags ?? null,
        boost_tags: boost_tags ?? null,
      })
      if (error) {
        return json({ error: "BM25 fallback failed", detail: error.message }, 500)
      }
      results = data ?? []
    }

    return json({ results, embedded })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
