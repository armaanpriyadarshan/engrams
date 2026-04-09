// health-check — engram observability one-shot.
//
// Runs a series of independent checks against an engram + the
// surrounding project state and returns a structured list of
// {id, label, status, detail, fix_hint}. The Stats > Health panel
// renders this as a vertical list with status dots.
//
// What we check:
//   openai_api          — can we list models with the configured key?
//   openai_embedding    — does text-embedding-3-small return 1536 dims?
//   articles_schema     — are the expected columns present?
//   fts_coverage        — what fraction of non-summary articles have an
//                          fts tsvector populated?
//   embedding_coverage  — what fraction of concept articles have an
//                          embedding vector populated?
//   recompile_stuck     — any recompile_queue rows in 'running' for
//                          more than 5 minutes? (likely orphaned)
//   sources_stuck       — any sources in 'pending' for more than 10
//                          minutes? (compile-source died mid-run)
//   lint_errors         — count of open lint_findings with severity=error
//
// Each check is wrapped in try/catch so a single failure doesn't
// blackhole the whole report.
//
// Request: { engram_id: uuid }
// Response: { checks: HealthCheck[], summary: { pass, warn, fail } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type Status = "pass" | "warn" | "fail"

interface HealthCheck {
  id: string
  label: string
  status: Status
  detail: string
  fix_hint?: string
}

const RECOMPILE_STUCK_MINUTES = 5
const SOURCE_STUCK_MINUTES = 10

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { engram_id } = await req.json()
    if (!engram_id) return json({ error: "engram_id required" }, 400)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // Confirm the engram exists before running per-engram checks.
    const { data: engram } = await supabase
      .from("engrams")
      .select("id")
      .eq("id", engram_id)
      .maybeSingle()
    if (!engram) return json({ error: "Engram not found" }, 404)

    const checks: HealthCheck[] = []
    const wrap = async (id: string, label: string, fn: () => Promise<HealthCheck>) => {
      try {
        checks.push(await fn())
      } catch (e) {
        checks.push({
          id,
          label,
          status: "fail",
          detail: `Check threw an error: ${String(e).slice(0, 300)}`,
        })
      }
    }

    // ── Provider checks ────────────────────────────────────────
    const { data: openaiKey } = await supabase.rpc("get_openai_key")

    await wrap("openai_api", "OpenAI API reachable", async () => {
      if (!openaiKey) {
        return {
          id: "openai_api",
          label: "OpenAI API reachable",
          status: "fail",
          detail: "OPENAI_API_KEY is not configured.",
          fix_hint: "Set OPENAI_API_KEY in the Supabase project settings.",
        }
      }
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${openaiKey}` },
      })
      if (!res.ok) {
        const body = await res.text()
        return {
          id: "openai_api",
          label: "OpenAI API reachable",
          status: "fail",
          detail: `HTTP ${res.status}: ${body.slice(0, 200)}`,
          fix_hint: "Verify the API key is valid and has spending available.",
        }
      }
      return {
        id: "openai_api",
        label: "OpenAI API reachable",
        status: "pass",
        detail: "Listed models successfully.",
      }
    })

    await wrap("openai_embedding", "Embedding model functional", async () => {
      if (!openaiKey) {
        return {
          id: "openai_embedding",
          label: "Embedding model functional",
          status: "fail",
          detail: "OPENAI_API_KEY is not configured.",
        }
      }
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: "engrams health check",
        }),
      })
      if (!res.ok) {
        return {
          id: "openai_embedding",
          label: "Embedding model functional",
          status: "fail",
          detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
          fix_hint: "Verify text-embedding-3-small is enabled for this key.",
        }
      }
      const data = await res.json()
      const dims = data.data?.[0]?.embedding?.length ?? 0
      if (dims !== 1536) {
        return {
          id: "openai_embedding",
          label: "Embedding model functional",
          status: "warn",
          detail: `Expected 1536 dimensions, got ${dims}.`,
          fix_hint:
            "Hybrid search expects 1536-dim embeddings. Check if the model has changed.",
        }
      }
      return {
        id: "openai_embedding",
        label: "Embedding model functional",
        status: "pass",
        detail: "Returned 1536 dimensions as expected.",
      }
    })

    // ── Schema checks ──────────────────────────────────────────
    await wrap("articles_schema", "Articles schema current", async () => {
      // Probe for the columns we depend on. A successful select with
      // all columns indicates the schema is current.
      const { error } = await supabase
        .from("articles")
        .select("id, embedding, fts, article_type, source_ids")
        .eq("engram_id", engram_id)
        .limit(1)
      if (error) {
        return {
          id: "articles_schema",
          label: "Articles schema current",
          status: "fail",
          detail: `Schema query failed: ${error.message}`,
          fix_hint: "Run pending migrations.",
        }
      }
      return {
        id: "articles_schema",
        label: "Articles schema current",
        status: "pass",
        detail: "All expected columns present.",
      }
    })

    // ── Coverage checks ────────────────────────────────────────
    await wrap("fts_coverage", "Full-text index coverage", async () => {
      const { count: total } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .neq("article_type", "summary")
      const { count: missing } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .neq("article_type", "summary")
        .is("fts", null)
      if ((total ?? 0) === 0) {
        return {
          id: "fts_coverage",
          label: "Full-text index coverage",
          status: "pass",
          detail: "No articles to index yet.",
        }
      }
      const missCount = missing ?? 0
      if (missCount > 0) {
        return {
          id: "fts_coverage",
          label: "Full-text index coverage",
          status: "warn",
          detail: `${missCount}/${total} articles have no FTS tsvector.`,
          fix_hint:
            "The fts column should be a generated tsvector. Touch each article (UPDATE ... SET title = title) to refresh.",
        }
      }
      return {
        id: "fts_coverage",
        label: "Full-text index coverage",
        status: "pass",
        detail: `All ${total} articles indexed for FTS.`,
      }
    })

    await wrap("embedding_coverage", "Embedding coverage", async () => {
      const { count: total } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .neq("article_type", "summary")
      const { count: missing } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .neq("article_type", "summary")
        .is("embedding", null)
      if ((total ?? 0) === 0) {
        return {
          id: "embedding_coverage",
          label: "Embedding coverage",
          status: "pass",
          detail: "No articles to embed yet.",
        }
      }
      const missCount = missing ?? 0
      if (missCount === 0) {
        return {
          id: "embedding_coverage",
          label: "Embedding coverage",
          status: "pass",
          detail: `All ${total} articles embedded.`,
        }
      }
      const ratio = missCount / (total ?? 1)
      const status: Status = ratio > 0.5 ? "fail" : "warn"
      return {
        id: "embedding_coverage",
        label: "Embedding coverage",
        status,
        detail: `${missCount}/${total} articles have no embedding (${Math.round(ratio * 100)}%). Hybrid search will fall back to BM25-only for these.`,
        fix_hint:
          "Invoke the generate-embedding edge function for the engram, or recompile sources to backfill.",
      }
    })

    // ── Liveness checks ────────────────────────────────────────
    await wrap("recompile_stuck", "No stuck recompiles", async () => {
      const cutoff = new Date(
        Date.now() - RECOMPILE_STUCK_MINUTES * 60 * 1000,
      ).toISOString()
      const { count } = await supabase
        .from("recompile_queue")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .eq("status", "running")
        .lt("attempted_at", cutoff)
      const c = count ?? 0
      if (c === 0) {
        return {
          id: "recompile_stuck",
          label: "No stuck recompiles",
          status: "pass",
          detail: "Queue is healthy.",
        }
      }
      return {
        id: "recompile_stuck",
        label: "No stuck recompiles",
        status: "warn",
        detail: `${c} recompile rows have been running for more than ${RECOMPILE_STUCK_MINUTES} minutes.`,
        fix_hint:
          "Manually flip them back to status='pending' and re-invoke propagate-edits, or status='failed' to drop them.",
      }
    })

    await wrap("sources_stuck", "No sources stuck pending", async () => {
      const cutoff = new Date(
        Date.now() - SOURCE_STUCK_MINUTES * 60 * 1000,
      ).toISOString()
      const { count } = await supabase
        .from("sources")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .eq("status", "pending")
        .lt("created_at", cutoff)
      const c = count ?? 0
      if (c === 0) {
        return {
          id: "sources_stuck",
          label: "No sources stuck pending",
          status: "pass",
          detail: "All recent sources have moved past pending.",
        }
      }
      return {
        id: "sources_stuck",
        label: "No sources stuck pending",
        status: "warn",
        detail: `${c} source${c === 1 ? "" : "s"} have been pending for more than ${SOURCE_STUCK_MINUTES} minutes.`,
        fix_hint:
          "Re-invoke compile-source for each, or mark them failed and remove.",
      }
    })

    await wrap("lint_errors", "No open lint errors", async () => {
      const { count } = await supabase
        .from("lint_findings")
        .select("id", { count: "exact", head: true })
        .eq("engram_id", engram_id)
        .eq("status", "open")
        .eq("severity", "error")
      const c = count ?? 0
      if (c === 0) {
        return {
          id: "lint_errors",
          label: "No open lint errors",
          status: "pass",
          detail: "No error-severity findings.",
        }
      }
      return {
        id: "lint_errors",
        label: "No open lint errors",
        status: "warn",
        detail: `${c} open lint finding${c === 1 ? "" : "s"} at severity=error.`,
        fix_hint:
          "Open Stats > Findings, filter to error severity, and either fix or dismiss them.",
      }
    })

    // Compute summary
    const summary = { pass: 0, warn: 0, fail: 0 }
    for (const c of checks) summary[c.status]++

    return json({ checks, summary })
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
