// capture-knowledge — extract durable knowledge from a conversation excerpt.
//
// The bridge between any MCP-capable client (Claude Code, Cursor, the
// Claude desktop app) and an engram. The user says "save what we just
// figured out about X to my Coffee engram" and this function:
//
//   1. Runs an LLM extraction pass on the raw chat text
//   2. Produces a list of knowledge items — decisions, discoveries,
//      corrections, gotchas — with titles and bodies
//   3. Filters out noise: greetings, retries, dead ends, stale
//      speculation the conversation later rejected
//   4. Writes each item as a source row with source_type='capture'
//   5. Fires compile-source on each so the two-pass compiler picks
//      them up and folds them into the wiki
//
// Each captured item becomes its own source. That's intentional: the
// compiler treats sources as atomic units of provenance, and one chat
// session can contain multiple unrelated decisions that belong in
// different concept articles.
//
// Request shape:
//   {
//     engram_id: uuid,
//     content: string,          // raw conversation excerpt (up to ~40k chars)
//     context?: string,         // optional "what was the conversation about"
//     tags?: string[]           // optional suggested tags for the captured sources
//   }
//
// Response shape:
//   {
//     items_captured: number,
//     source_ids: uuid[],
//     items: Array<{ title, kind, source_id }>,
//     skipped_reason?: string    // set when the extraction found nothing
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const MAX_CONTENT = 40_000
const MAX_ITEMS_PER_CAPTURE = 8

type KnowledgeKind = "decision" | "discovery" | "correction" | "gotcha" | "fact"

interface KnowledgeItem {
  title: string
  body: string
  kind: KnowledgeKind
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const engram_id: string = body.engram_id
    const rawContent: string = typeof body.content === "string" ? body.content : ""
    const context: string = typeof body.context === "string" ? body.context : ""
    const userTags: string[] = Array.isArray(body.tags) ? body.tags : []

    if (!engram_id || !rawContent.trim()) {
      return json({ error: "engram_id and content are required" }, 400)
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const { data: openaiKey } = await supabase.rpc("get_openai_key")
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500)
    }

    // Verify the engram exists and we can actually write to it.
    const { data: engram, error: engramErr } = await supabase
      .from("engrams")
      .select("id, name")
      .eq("id", engram_id)
      .maybeSingle()
    if (engramErr || !engram) {
      return json({ error: "Engram not found" }, 404)
    }

    const content = rawContent.slice(0, MAX_CONTENT)

    // Log an agent_run row so captures show up on the timeline and
    // activity widgets alongside compiles and lints.
    const startedAt = Date.now()
    const { data: agentRun } = await supabase
      .from("agent_runs")
      .insert({
        engram_id,
        agent_type: "capture",
        status: "running",
        detail: {
          context: context.slice(0, 300),
          content_length: content.length,
        },
      })
      .select("id")
      .single()
    const agentRunId = agentRun?.id ?? null

    const finishRun = async (
      status: "completed" | "failed",
      summary: string,
      detail: Record<string, unknown>,
    ) => {
      if (!agentRunId) return
      await supabase
        .from("agent_runs")
        .update({
          status,
          summary: summary.slice(0, 300),
          detail,
          duration_ms: Date.now() - startedAt,
          finished_at: new Date().toISOString(),
        })
        .eq("id", agentRunId)
    }

    // Run the extraction pass.
    const extracted = await extractKnowledgeItems({
      openaiKey,
      content,
      context,
    })

    if ("error" in extracted) {
      await finishRun("failed", "Extraction failed", { error: extracted.error })
      return json({ error: "Extraction failed", detail: extracted.error }, 502)
    }

    if (extracted.items.length === 0) {
      await finishRun("completed", "Nothing worth capturing.", {
        skipped_reason: extracted.skipped_reason ?? "no_items",
      })
      return json({
        items_captured: 0,
        source_ids: [],
        items: [],
        skipped_reason: extracted.skipped_reason ?? "no_items",
      })
    }

    // Insert one source row per extracted item. Each carries the same
    // capture metadata so the provenance is recoverable.
    const capturedAt = new Date().toISOString()
    const rowsToInsert = extracted.items.map((item) => ({
      engram_id,
      source_type: "capture",
      title: item.title.slice(0, 200),
      content_md: buildSourceBody(item, context),
      status: "pending",
      metadata: {
        kind: item.kind,
        captured_at: capturedAt,
        captured_from: "mcp",
        context: context || null,
        user_tags: userTags,
      },
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from("sources")
      .insert(rowsToInsert)
      .select("id, title")

    if (insertErr || !inserted) {
      await finishRun("failed", "Failed to insert sources", {
        error: insertErr?.message,
      })
      return json(
        { error: "Failed to insert sources", detail: insertErr?.message },
        500,
      )
    }

    // Fire compile-source for each new source. Fire-and-forget: we
    // return promptly so the MCP client isn't blocked on N LLM calls.
    // Each compile will in turn fire propagate-edits and deterministic
    // lint as it normally does.
    for (const src of inserted) {
      supabase.functions
        .invoke("compile-source", { body: { source_id: src.id } })
        .catch((e) =>
          console.error("[capture-knowledge] compile-source invoke failed", e),
        )
    }

    const items = extracted.items.map((item, i) => ({
      title: item.title,
      kind: item.kind,
      source_id: inserted[i]?.id,
    }))

    await finishRun("completed", `${inserted.length} captured.`, {
      items_captured: inserted.length,
      kinds: countKinds(extracted.items),
    })

    return json({
      items_captured: inserted.length,
      source_ids: inserted.map((s) => s.id),
      items,
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// ────────────────────────────────────────────────────────────────────
// Build the content_md body for a captured source.
//
// Including the context header + the kind + the body makes the source
// legible both to the two-pass compiler (Pass A will summarize the
// whole block) and to a human who opens the Sources page and reads
// the raw content. The kind tag gives the compiler an obvious signal
// for how to treat the material (decisions should become claims,
// discoveries should become concepts, corrections should tighten
// existing articles, etc.).
// ────────────────────────────────────────────────────────────────────
function buildSourceBody(item: KnowledgeItem, context: string): string {
  const header = context
    ? `> Captured from conversation: ${context}\n\n`
    : "> Captured from conversation.\n\n"
  const kindLabel = `**Kind:** ${item.kind}\n\n`
  return `${header}${kindLabel}# ${item.title}\n\n${item.body}`
}

function countKinds(items: KnowledgeItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[item.kind] = (out[item.kind] ?? 0) + 1
  return out
}

// ────────────────────────────────────────────────────────────────────
// LLM extraction.
//
// Prompt design goals:
//   • Actively reject noise. Greetings, retries, speculative
//     wondering, dead-end hypotheses the conversation later rejected,
//     general chit-chat — all should be filtered out.
//   • Pick durable nuggets. A decision with a reason, a discovery
//     with enough context to stand alone, a correction that fixes a
//     previously-held belief, a gotcha that would save future-you
//     time.
//   • Each item should be self-contained. If the compiler later reads
//     it without the surrounding conversation, it must still be
//     understandable.
//   • Small N. Err on the side of fewer, denser items. 0 is a valid
//     answer — skipping a conversation is better than manufacturing
//     junk.
// ────────────────────────────────────────────────────────────────────
async function extractKnowledgeItems(opts: {
  openaiKey: string
  content: string
  context: string
}): Promise<
  { items: KnowledgeItem[]; skipped_reason?: string } | { error: string }
> {
  const systemPrompt = `You are a knowledge curator for Engrams, an LLM-compiled wiki.

A user has pointed you at an excerpt from a conversation and asked you to extract durable knowledge from it into the wiki. Your job is to pick out only the parts that are worth remembering and skip everything else.

What to capture:
- decision: a concrete choice that was made, with its reasoning.
- discovery: a new fact, relationship, or insight that came out of the conversation.
- correction: a previously-held belief that turned out to be wrong, with the right answer.
- gotcha: a non-obvious pitfall or constraint that would trip up a reader encountering the same thing later.
- fact: a standalone piece of information worth remembering on its own.

What to skip:
- Greetings, pleasantries, meta-commentary about the conversation itself.
- Speculation or hypotheses that the conversation later abandoned.
- Request/response boilerplate ("let me check", "thanks", "can you clarify").
- Summaries of information the wiki would already know from its sources.
- Anything that only makes sense in the immediate conversation context.

Quality rules:
- Each item must stand on its own. A reader coming across it six months later must understand it without the conversation.
- Prefer specific over general. "Use content_hash = SHA-256 of trimmed content for dedup" is better than "Hash things for dedup".
- Each item has a short title (under 80 chars) and a body of 1–5 sentences. Bodies can be longer for discoveries that need context.
- Max ${MAX_ITEMS_PER_CAPTURE} items. If you find more, pick the most durable.
- If the conversation contains nothing worth capturing, return an empty items array with a one-line skipped_reason.

Return ONLY valid JSON, no markdown fences.`

  const userPrompt =
    (opts.context ? `## Conversation Context\n${opts.context}\n\n` : "") +
    `## Excerpt\n${opts.content}\n\n` +
    `## Output Format\n` +
    `{\n` +
    `  "items": [\n` +
    `    { "title": "short title", "body": "1-5 sentence body", "kind": "decision" }\n` +
    `  ],\n` +
    `  "skipped_reason": "only set when items is empty, e.g. 'conversation was chit-chat with no durable content'"\n` +
    `}`

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${opts.openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  })

  if (!res.ok) {
    return { error: (await res.text()).slice(0, 500) }
  }

  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content
  if (!raw) return { error: "empty response" }

  try {
    const parsed = JSON.parse(raw) as {
      items?: Array<{ title?: string; body?: string; kind?: string }>
      skipped_reason?: string
    }

    const allowedKinds: Set<string> = new Set([
      "decision",
      "discovery",
      "correction",
      "gotcha",
      "fact",
    ])

    const items: KnowledgeItem[] = []
    for (const raw of parsed.items ?? []) {
      if (!raw.title || !raw.body) continue
      const kind = allowedKinds.has(raw.kind ?? "") ? (raw.kind as KnowledgeKind) : "fact"
      items.push({
        title: raw.title.trim(),
        body: raw.body.trim(),
        kind,
      })
      if (items.length >= MAX_ITEMS_PER_CAPTURE) break
    }

    return {
      items,
      skipped_reason:
        items.length === 0
          ? (parsed.skipped_reason ?? "no durable content")
          : undefined,
    }
  } catch (err) {
    return { error: `parse error: ${String(err).slice(0, 200)}` }
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
