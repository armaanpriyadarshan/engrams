// propagate-edits — drain the recompile queue for an engram.
//
// Invoked fire-and-forget from compile-source after a source change has
// enqueued downstream articles. For each pending queue entry:
//
//   1. Load the article (content_md, summary, source_ids, tags, etc.)
//   2. Load all cited sources' current content_md
//   3. Ask the LLM to rewrite the article incorporating any new info,
//      preserving the slug, voice, and any [[wikilinks]] that still resolve
//   4. Update the article row in place — same slug, new content
//   5. Re-embed the article so semantic search stays accurate
//   6. Mark the queue entry completed
//
// Batch budget: up to DRAIN_BATCH per invocation (keeps us inside the
// Supabase edge function wall-clock budget). If more are still pending
// at the end, self-invoke once and exit cleanly. The new invocation
// claims the next batch via the status='running' transition.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DRAIN_BATCH = 5          // articles to rewrite per invocation
const MAX_ATTEMPTS = 3          // give up on a row after this many failures
const MAX_SOURCE_CONTEXT = 8_000 // per source, truncate before prompting

interface QueueRow {
  id: string
  engram_id: string
  article_slug: string
  reason: string
  attempts: number
}

interface ArticleRow {
  id: string
  engram_id: string
  slug: string
  title: string
  summary: string | null
  content_md: string | null
  tags: string[] | null
  article_type: string | null
  confidence: number | null
  source_ids: string[] | null
  related_slugs: string[] | null
}

interface SourceRow {
  id: string
  title: string | null
  source_type: string | null
  content_md: string | null
  summary_slug: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  try {
    const { engram_id } = await req.json()
    if (!engram_id) {
      return json({ error: "engram_id required" }, 400)
    }

    const { data: openaiKey } = await supabase.rpc("get_openai_key")
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500)
    }

    // Claim a batch: take up to DRAIN_BATCH pending rows and flip them to
    // 'running' so parallel invocations don't double-process. We select first
    // to avoid SKIP LOCKED complications — the partial unique index on
    // (engram_id, slug) where status='pending' is our real concurrency guard.
    const { data: claimed, error: claimErr } = await supabase
      .from("recompile_queue")
      .select("id, engram_id, article_slug, reason, attempts")
      .eq("engram_id", engram_id)
      .eq("status", "pending")
      .order("enqueued_at", { ascending: true })
      .limit(DRAIN_BATCH)

    if (claimErr) {
      return json({ error: "Failed to claim queue entries", detail: claimErr.message }, 500)
    }

    const rows = (claimed ?? []) as QueueRow[]
    if (rows.length === 0) {
      return json({ drained: 0, remaining: 0 })
    }

    // Mark them running in one update so the UI can light up badges.
    await supabase
      .from("recompile_queue")
      .update({
        status: "running",
        attempted_at: new Date().toISOString(),
        attempts: rows[0].attempts + 1,
      })
      .in("id", rows.map((r) => r.id))

    // Agent run row — lets the Stats / timeline reflect this work.
    const { data: agentRun } = await supabase
      .from("agent_runs")
      .insert({
        engram_id,
        agent_type: "propagate",
        status: "running",
        detail: {
          batch_size: rows.length,
          reasons: rows.map((r) => r.reason),
        },
      })
      .select("id")
      .single()

    let drained = 0
    let failed = 0
    const errors: string[] = []

    for (const row of rows) {
      try {
        await rewriteOne(supabase, openaiKey, row)
        await supabase
          .from("recompile_queue")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", row.id)
        drained++
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${row.article_slug}: ${msg}`)
        const nextAttempts = row.attempts + 1
        const terminal = nextAttempts >= MAX_ATTEMPTS
        await supabase
          .from("recompile_queue")
          .update({
            status: terminal ? "failed" : "pending",
            last_error: msg.slice(0, 500),
          })
          .eq("id", row.id)
      }
    }

    // Count remaining to decide whether to continue the drain in a new
    // invocation. Completed/failed rows don't count.
    const { count: remaining } = await supabase
      .from("recompile_queue")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", engram_id)
      .eq("status", "pending")

    // Finish agent run.
    if (agentRun?.id) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          summary: `${drained} rewritten${failed > 0 ? `, ${failed} failed` : ""}.`,
          detail: {
            drained,
            failed,
            remaining,
            errors: errors.slice(0, 5),
          },
          finished_at: new Date().toISOString(),
        })
        .eq("id", agentRun.id)
    }

    // Self-continue if there's more work. Fire-and-forget.
    if ((remaining ?? 0) > 0) {
      supabase.functions
        .invoke("propagate-edits", { body: { engram_id } })
        .catch((e) =>
          console.error("[propagate-edits] self-continue invoke failed", e),
        )
    }

    return json({ drained, failed, remaining })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// ────────────────────────────────────────────────────────────────────
// Rewrite one article against its current sources.
// ────────────────────────────────────────────────────────────────────
async function rewriteOne(
  supabase: ReturnType<typeof createClient>,
  openaiKey: string,
  row: QueueRow,
): Promise<void> {
  // Load the article.
  const { data: article, error: artErr } = await supabase
    .from("articles")
    .select(
      "id, engram_id, slug, title, summary, content_md, tags, article_type, confidence, source_ids, related_slugs",
    )
    .eq("engram_id", row.engram_id)
    .eq("slug", row.article_slug)
    .single()

  if (artErr || !article) {
    throw new Error(`article not found: ${row.article_slug}`)
  }

  const art = article as ArticleRow
  const sourceIds: string[] = art.source_ids ?? []
  if (sourceIds.length === 0) {
    // Nothing to rewrite against — mark as a no-op success.
    return
  }

  // Load the current sources this article cites.
  const { data: sources, error: srcErr } = await supabase
    .from("sources")
    .select("id, title, source_type, content_md, summary_slug")
    .in("id", sourceIds)

  if (srcErr) {
    throw new Error(`source fetch: ${srcErr.message}`)
  }

  const srcRows = (sources ?? []) as SourceRow[]
  if (srcRows.length === 0) {
    // All sources have been deleted — skip rewrite, leave article as-is.
    return
  }

  // Prefer summary articles over raw source content. Pre-load every
  // summary article for this batch of sources in a single round-trip.
  //
  // Why: a concept article's re-write should read the LLM-authored
  // summary of each cited source, not the raw source. Summaries are
  // ~10× smaller and are the durable intermediate artifact the two-
  // pass compiler produces. Sources that don't have a summary yet
  // (legacy pre-Sprint-1.4 sources) fall back to content_md.
  const summarySlugs = srcRows
    .map((s) => s.summary_slug)
    .filter((slug): slug is string => !!slug)

  const summaryBySlug = new Map<string, string>()
  if (summarySlugs.length > 0) {
    const { data: summaries } = await supabase
      .from("articles")
      .select("slug, content_md")
      .eq("engram_id", art.engram_id)
      .in("slug", summarySlugs)
    for (const row of (summaries ?? []) as { slug: string; content_md: string | null }[]) {
      if (row.content_md) summaryBySlug.set(row.slug, row.content_md)
    }
  }

  // Build the context block. For each source: prefer its summary, fall
  // back to a truncated slice of the raw content_md. Truncate each
  // entry individually so one giant source can't starve the others.
  const sourceContext = srcRows
    .map((s, i) => {
      const usingSummary = s.summary_slug && summaryBySlug.has(s.summary_slug)
      const body = usingSummary
        ? (summaryBySlug.get(s.summary_slug!) ?? "")
        : (s.content_md ?? "").slice(0, MAX_SOURCE_CONTEXT)
      const kind = usingSummary ? "summary" : "raw"
      const head = `## Source ${i + 1} (${kind}): ${s.title ?? s.source_type ?? "untitled"}\n\n`
      return head + body
    })
    .join("\n\n---\n\n")

  // The existing article provides voice, tone, and wikilink scaffolding
  // that the LLM should preserve unless the source material demands a
  // change.
  const existingBlock =
    `## Existing Article\n\nSlug: ${art.slug}\n` +
    `Title: ${art.title}\n` +
    `Summary: ${art.summary ?? ""}\n\n` +
    `Body:\n${art.content_md ?? ""}`

  const systemPrompt = `You are a wiki editor for a knowledge compiler called Engrams.

A source document this article cites has been updated. Rewrite the article so it accurately reflects the current source material.

Rules:
- Preserve the slug exactly. Never change it.
- Preserve the article's voice and encyclopedic tone. No first person. No hedging.
- Keep [[wikilinks]] that still make sense. Drop links whose targets are not obviously related anymore.
- If the sources contradict existing claims, rewrite those claims to match the new sources. Do not leave stale facts in place.
- Do not invent sources or claims beyond what the provided source material supports.
- Adjust confidence upward if the sources now give stronger support, downward if weaker.
- Return ONLY valid JSON, no markdown fences.`

  const userPrompt =
    `${existingBlock}\n\n## Current Source Material\n\n${sourceContext}\n\n## Output Format\n\n{\n  "title": "Article title",\n  "summary": "One-sentence summary.",\n  "content_md": "Rewritten article body in markdown. Use [[slug]] links.",\n  "tags": ["tag1", "tag2"],\n  "confidence": 0.85\n}`

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  })

  if (!openaiRes.ok) {
    const body = await openaiRes.text()
    throw new Error(`openai: ${openaiRes.status} ${body.slice(0, 200)}`)
  }

  const data = await openaiRes.json()
  const parsed = JSON.parse(data.choices[0].message.content) as {
    title?: string
    summary?: string
    content_md?: string
    tags?: string[]
    confidence?: number
  }

  if (!parsed.content_md || !parsed.content_md.trim()) {
    throw new Error("rewrite produced no content_md")
  }

  // Extract wikilinks from the new body to keep related_slugs fresh.
  const linked = new Set<string>()
  for (const m of parsed.content_md.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) {
    if (m[1] !== art.slug) linked.add(m[1])
  }

  await supabase
    .from("articles")
    .update({
      title: parsed.title ?? art.title,
      summary: parsed.summary ?? art.summary,
      content_md: parsed.content_md,
      tags: parsed.tags ?? art.tags,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : art.confidence,
      related_slugs: Array.from(linked),
      updated_at: new Date().toISOString(),
    })
    .eq("id", art.id)

  // Re-embed the new content. Fire-and-forget — if this fails the
  // article is still correct, it just won't rank as well in semantic
  // search until the next compile.
  supabase.functions
    .invoke("generate-embedding", {
      body: { engram_id: art.engram_id, slug: art.slug },
    })
    .catch((e) =>
      console.error("[propagate-edits] embed invoke failed", e),
    )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
