// promote-finding-to-rule — turn a lint_findings row into a prevention_rule.
//
// The bridge between Sprint 2.3 (lint) and Sprint 1.5 (prevention rules).
// When the user sees a finding that represents a recurring quality issue
// they don't want the compiler to repeat, they click "promote to rule"
// and this function:
//
//   1. Loads the finding + the first related article (for context)
//   2. Passes the finding's summary + detail as `correction_text` into
//      the same LLM distillation prompt used by add-prevention-rule
//   3. Inserts a prevention_rules row with created_from='lint'
//   4. Marks the finding status='resolved' with reason='promoted' so it
//      drops off the active panel
//
// Request shape:
//   { finding_id: uuid }
//
// Response shape:
//   { rule: PreventionRuleRow }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface DistilledRule {
  when_condition: string
  check_condition: string
  because: string
  tags: string[]
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { finding_id } = await req.json()
    if (!finding_id) return json({ error: "finding_id required" }, 400)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const { data: finding, error: findErr } = await supabase
      .from("lint_findings")
      .select("id, engram_id, finding_type, summary, detail, related_slugs, severity")
      .eq("id", finding_id)
      .single()

    if (findErr || !finding) {
      return json({ error: "Finding not found", detail: findErr?.message }, 404)
    }

    const { data: openaiKey } = await supabase.rpc("get_openai_key")
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500)
    }

    // Load the first related article (if any) so the distilled rule has
    // some article context. The finding's related_slugs is text[] of
    // article slugs; lint findings typically name the article they're
    // about as the first entry.
    const primarySlug: string | null =
      Array.isArray(finding.related_slugs) && finding.related_slugs.length > 0
        ? finding.related_slugs[0]
        : null

    let articleTitle = ""
    let articleContent = ""
    let articleTags: string[] = []
    if (primarySlug) {
      const { data: art } = await supabase
        .from("articles")
        .select("title, content_md, tags")
        .eq("engram_id", finding.engram_id)
        .eq("slug", primarySlug)
        .maybeSingle()
      if (art) {
        articleTitle = art.title ?? primarySlug
        articleContent = art.content_md ?? ""
        articleTags = art.tags ?? []
      }
    }

    // The finding's summary + detail is the "user correction" for
    // distillation purposes. Feeding both gives the LLM the headline
    // and the evidence.
    const correctionText = `${finding.summary}\n\n${finding.detail}`

    const distilled = await distillRule({
      openaiKey,
      articleTitle,
      articleContent,
      articleTags,
      correctionText,
      userTags: [finding.finding_type], // tag the rule with the originating pass
    })

    if ("error" in distilled) {
      return json({ error: "Could not distill rule", detail: distilled.error }, 502)
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("prevention_rules")
      .insert({
        engram_id: finding.engram_id,
        when_condition: distilled.when_condition,
        check_condition: distilled.check_condition,
        because: distilled.because,
        tags: distilled.tags,
        status: "active",
        weight: 1.0,
        created_from: "lint",
        created_by_article_slug: primarySlug,
        correction_text: correctionText.slice(0, 2000),
      })
      .select()
      .single()

    if (insertErr) {
      return json({ error: "Failed to store rule", detail: insertErr.message }, 500)
    }

    // Mark the finding as resolved via promotion so the panel drops it.
    await supabase
      .from("lint_findings")
      .update({
        status: "resolved",
        resolved_reason: "promoted",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", finding_id)

    return json({ rule: inserted })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// ────────────────────────────────────────────────────────────────────
// Rule distillation (same shape as add-prevention-rule).
// ────────────────────────────────────────────────────────────────────
async function distillRule(opts: {
  openaiKey: string
  articleTitle: string
  articleContent: string
  articleTags: string[]
  correctionText: string
  userTags: string[]
}): Promise<DistilledRule | { error: string }> {
  const systemPrompt = `You are a knowledge editor for an LLM-compiled wiki called Engrams.

A lint pass has flagged a quality issue. Your job is to distill the issue into a structured prevention rule in WHEN/CHECK/BECAUSE form. The rule will be injected into future compile prompts so the compiler does not repeat the same mistake.

Structure:
- WHEN: the trigger condition. What situation or topic does this rule apply to? Generalize beyond the single article — "when writing about espresso extraction" not "when rewriting the espresso-extraction article".
- CHECK: the specific thing to verify. An observable, falsifiable condition. "Ensure yields are expressed in grams not milliliters."
- BECAUSE: the one-sentence rationale drawn from the lint finding.

Also produce 1-5 lowercase tags (one or two words each) that capture the domain of this rule. These drive relevance at compile time — rules are matched against the tags of the source/concept being written.

Rules for the rule:
- The WHEN clause must generalize. Do not mention the specific article slug or title.
- The CHECK clause must be actionable and verifiable by reading text.
- The BECAUSE clause is one sentence. Keep it terse.
- Tags are domain-relevant.

Return ONLY valid JSON, no markdown fences.`

  const userPrompt =
    `## Article Title\n${opts.articleTitle || "(no primary article)"}\n\n` +
    `## Article Tags\n${opts.articleTags.length ? opts.articleTags.join(", ") : "(none)"}\n\n` +
    (opts.articleContent
      ? `## Article Body\n${opts.articleContent.slice(0, 3_000)}\n\n`
      : "") +
    `## Lint Finding\n${opts.correctionText}\n\n` +
    `## Originating Pass Tag\n${opts.userTags.join(", ")}\n\n` +
    `## Output Format\n` +
    `{\n` +
    `  "when_condition": "When writing about ...",\n` +
    `  "check_condition": "Ensure that ...",\n` +
    `  "because": "Past lint findings showed ...",\n` +
    `  "tags": ["domain-tag-1", "domain-tag-2"]\n` +
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
  const content = data.choices?.[0]?.message?.content
  if (!content) return { error: "empty response" }

  try {
    const parsed = JSON.parse(content)
    const when_condition =
      typeof parsed.when_condition === "string" ? parsed.when_condition.trim() : ""
    const check_condition =
      typeof parsed.check_condition === "string" ? parsed.check_condition.trim() : ""
    const because = typeof parsed.because === "string" ? parsed.because.trim() : ""

    if (!when_condition || !check_condition || !because) {
      return { error: "LLM produced incomplete rule fields" }
    }

    const rawTags: unknown[] = Array.isArray(parsed.tags) ? parsed.tags : []
    const tags = rawTags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0 && t.length < 32)
      .slice(0, 5)

    // Merge the originating pass tag first so the rule is always
    // identifiable by source.
    const userTagsClean = opts.userTags
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0 && t.length < 32)
    const mergedTags = Array.from(new Set([...userTagsClean, ...tags])).slice(0, 5)

    return {
      when_condition,
      check_condition,
      because,
      tags: mergedTags,
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
