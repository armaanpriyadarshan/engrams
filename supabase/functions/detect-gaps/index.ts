import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Cap the number of articles we include in the prompt so the input
// stays under gpt-4o-mini's 128k context even for large engrams. On
// engrams with more than this many articles we prioritize the lowest-
// confidence ones (most likely to surface gaps) and truncate the rest.
const MAX_ARTICLES_IN_PROMPT = 80

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
  // from the awaited result instead.
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
    if (error) console.error("[detect-gaps] finishRun update error", error)
  }

  try {
    const body = await req.json()
    const { engram_id, trigger_source_id } = body

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
      .insert({ engram_id, agent_type: "gaps", status: "running", trigger_id: trigger_source_id ?? null })
      .select("id")
      .single()
    agentRunId = runRow?.id ?? null

    // 1. Fetch articles — cap by lowest confidence so we don't blow the prompt budget
    const { data: articles, error: articlesErr } = await supabase
      .from("articles")
      .select("slug, title, summary, content_md, confidence, source_ids, tags, article_type")
      .eq("engram_id", engram_id)
      .neq("article_type", "summary")
      .order("confidence", { ascending: true, nullsFirst: true })
      .limit(MAX_ARTICLES_IN_PROMPT)

    if (articlesErr) {
      await finishRun("failed", "Could not fetch articles", { error: articlesErr.message })
      return new Response(JSON.stringify({ error: "Could not fetch articles", detail: articlesErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (!articles || articles.length < 2) {
      await finishRun("completed", "Not enough articles to analyze.", { articles_count: articles?.length ?? 0 })
      return new Response(JSON.stringify({ gaps_created: 0, gaps_resolved: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Fetch sources with their unresolved questions
    const { data: sources } = await supabase
      .from("sources")
      .select("id, title, unresolved_questions")
      .eq("engram_id", engram_id)

    // 3. Fetch existing open gaps
    const { data: existingGaps } = await supabase
      .from("knowledge_gaps")
      .select("id, question")
      .eq("engram_id", engram_id)
      .eq("status", "open")

    // 4. Build context for the LLM
    const articleSummaries = articles.map((a: { slug: string; title: string; summary: string | null; content_md: string | null; confidence: number | null }) => {
      const conf = Math.round((a.confidence ?? 0) * 100)
      const content = (a.content_md ?? "").slice(0, 800)
      return `## ${a.title} (${a.slug}, ${conf}% confidence)\n${a.summary ?? ""}\n${content}`
    }).join("\n\n---\n\n")

    const sourceQuestions = (sources ?? []).flatMap((s: { title: string; unresolved_questions: string[] | null }) => {
      const qs = s.unresolved_questions ?? []
      return qs.map((q: string) => `- "${q}" (from source: ${s.title})`)
    }).join("\n")

    const existingGapList = (existingGaps ?? []).map((g: { question: string }) => `- ${g.question}`).join("\n")

    // 5. Ask LLM to identify gaps
    const prompt = `You are a research analyst examining a knowledge base. Read all the articles below and identify genuine research gaps — questions that a reader would notice are unanswered after reading the full collection.

A gap is NOT:
- A topic that simply isn't covered (that's just scope)
- A vague "what about X?" question
- Something trivially answerable from the existing articles

A gap IS:
- A specific question that the existing articles raise but don't answer
- A contradiction or tension between articles that isn't resolved
- A mechanism, cause, or connection that multiple articles reference but none explain
- A claim made with low confidence that could be strengthened

For each gap, provide:
- question: A specific, well-phrased research question
- evidence: Which articles and sources surface this gap and how (be specific — quote or reference actual content)
- related_slugs: Array of article slugs that border this gap
- confidence_context: If relevant, note which articles touching this topic have low confidence
- suggested_sources: 1-2 specific types of sources that would help fill this gap (e.g. "a paper on X" or "primary data about Y")

${sourceQuestions ? `\nUnresolved questions extracted from sources:\n${sourceQuestions}\n` : ""}
${existingGapList ? `\nAlready identified gaps (don't duplicate these, but you can refine them):\n${existingGapList}\n` : ""}

Articles:\n${articleSummaries}

Return JSON: { "gaps": [...], "resolved": [] }
- gaps: array of new gaps found
- resolved: array of question strings from the existing gaps list that are now answered by the articles

Be selective. 2-5 gaps is typical. Quality over quantity.`

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a research gap analyst. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      await finishRun("failed", "LLM call failed", { error: err.slice(0, 500) })
      return new Response(JSON.stringify({ error: "LLM call failed", detail: err }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const llmData = await res.json()
    const rawContent = llmData.choices?.[0]?.message?.content
    if (!rawContent) {
      await finishRun("failed", "LLM returned empty content", { llm_response: JSON.stringify(llmData).slice(0, 500) })
      return new Response(JSON.stringify({ error: "LLM returned empty content" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let result: { gaps?: Array<Record<string, unknown>>; resolved?: string[] }
    try {
      result = JSON.parse(rawContent)
    } catch (parseErr) {
      await finishRun("failed", "Could not parse LLM JSON", { parse_error: String(parseErr), content_preview: rawContent.slice(0, 300) })
      return new Response(JSON.stringify({ error: "Could not parse LLM JSON", detail: String(parseErr) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 6. Insert new gaps
    let gapsCreated = 0
    for (const gap of result.gaps ?? []) {
      const gapQuestion = typeof gap.question === "string" ? gap.question : null
      if (!gapQuestion) continue

      // Skip if too similar to an existing gap
      const isDuplicate = (existingGaps ?? []).some((eg: { question: string }) =>
        eg.question.toLowerCase().includes(gapQuestion.toLowerCase().slice(0, 40)) ||
        gapQuestion.toLowerCase().includes(eg.question.toLowerCase().slice(0, 40))
      )
      if (isDuplicate) continue

      // Find source_refs from related_slugs
      const relatedSlugs = Array.isArray(gap.related_slugs) ? (gap.related_slugs as string[]) : []
      const relatedArticles = articles.filter((a: { slug: string; source_ids: string[] | null }) => relatedSlugs.includes(a.slug))
      const sourceRefs = [...new Set(relatedArticles.flatMap((a: { source_ids: string[] | null }) => a.source_ids ?? []))]

      const suggestedSources = Array.isArray(gap.suggested_sources) ? gap.suggested_sources : []

      const { error: insertErr } = await supabase.from("knowledge_gaps").insert({
        engram_id,
        question: gapQuestion,
        evidence: typeof gap.evidence === "string" ? gap.evidence : "",
        related_slugs: relatedSlugs,
        source_refs: sourceRefs,
        confidence_context: typeof gap.confidence_context === "string" ? gap.confidence_context : null,
        suggested_sources: suggestedSources,
      })
      if (insertErr) {
        console.error("[detect-gaps] gap insert error", insertErr)
      } else {
        gapsCreated++
      }
    }

    // 7. Resolve gaps that the LLM says are now answered
    let gapsResolved = 0
    for (const resolvedQ of result.resolved ?? []) {
      if (typeof resolvedQ !== "string") continue
      const match = (existingGaps ?? []).find((eg: { id: string; question: string }) =>
        eg.question.toLowerCase().includes(resolvedQ.toLowerCase().slice(0, 40)) ||
        resolvedQ.toLowerCase().includes(eg.question.toLowerCase().slice(0, 40))
      )
      if (match) {
        const { error: resolveErr } = await supabase.from("knowledge_gaps").update({
          status: "resolved",
          resolved_by: trigger_source_id ?? null,
          resolved_at: new Date().toISOString(),
        }).eq("id", match.id)
        if (resolveErr) {
          console.error("[detect-gaps] gap resolve error", resolveErr)
        } else {
          gapsResolved++
        }
      }
    }

    const totalOpen = ((existingGaps?.length ?? 0) - gapsResolved) + gapsCreated
    const summary = gapsCreated === 0 && gapsResolved === 0
      ? "No new gaps."
      : `${gapsCreated} new, ${gapsResolved} resolved. ${totalOpen} open.`
    await finishRun("completed", summary, { gaps_created: gapsCreated, gaps_resolved: gapsResolved, total_open: totalOpen })

    return new Response(JSON.stringify({ gaps_created: gapsCreated, gaps_resolved: gapsResolved }), {
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
