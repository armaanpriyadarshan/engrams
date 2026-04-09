// add-prevention-rule — turns a free-form user correction on an article
// into a structured WHEN/CHECK/BECAUSE rule and stores it in
// prevention_rules. Future compiles of this engram load relevant rules
// and inject them at the top of Pass A and Pass B prompts.
//
// Request shape:
//   {
//     engram_id: uuid,
//     article_slug: string,
//     correction_text: string,   // what the user thinks is wrong
//     tags?: string[]             // optional user-provided tags
//   }
//
// Response shape:
//   { rule: PreventionRuleRow }   // the persisted row, including LLM-
//                                  // distilled when/check/because
//
// Never the user sees the raw LLM call — the client gets a clean rule
// object back.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface AddPreventionRuleRequest {
  engram_id: string
  article_slug: string
  correction_text: string
  tags?: string[]
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
    const body = (await req.json()) as AddPreventionRuleRequest
    const { engram_id, article_slug, correction_text, tags: userTags } = body

    if (!engram_id || !article_slug || !correction_text?.trim()) {
      return json(
        { error: "engram_id, article_slug, and correction_text are required" },
        400,
      )
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // Load the article so the LLM has the full context it's being
    // corrected against. If the article doesn't exist, we can still
    // mint a rule from the correction text alone.
    const { data: article } = await supabase
      .from("articles")
      .select("title, summary, content_md, tags")
      .eq("engram_id", engram_id)
      .eq("slug", article_slug)
      .maybeSingle()

    const { data: openaiKey } = await supabase.rpc("get_openai_key")
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500)
    }

    const distilled = await distillRule({
      openaiKey,
      articleTitle: article?.title ?? article_slug,
      articleContent: article?.content_md ?? "",
      articleTags: article?.tags ?? [],
      correctionText: correction_text.trim(),
      userTags: userTags ?? [],
    })

    if ("error" in distilled) {
      return json({ error: "Could not distill rule", detail: distilled.error }, 502)
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("prevention_rules")
      .insert({
        engram_id,
        when_condition: distilled.when_condition,
        check_condition: distilled.check_condition,
        because: distilled.because,
        tags: distilled.tags,
        status: "active",
        weight: 1.0,
        created_from: "user_correction",
        created_by_article_slug: article_slug,
        correction_text: correction_text.trim().slice(0, 2000),
      })
      .select()
      .single()

    if (insertErr) {
      return json({ error: "Failed to store rule", detail: insertErr.message }, 500)
    }

    return json({ rule: inserted })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// ────────────────────────────────────────────────────────────────────
// LLM-powered rule distillation.
//
// Takes the raw user correction plus the article it refers to and
// produces a terse WHEN/CHECK/BECAUSE rule. The critical design choice
// here is that the rule must be GENERALIZABLE — a rule that only says
// "the article about X is wrong because Y" teaches the compiler
// nothing. The prompt explicitly pushes the model to generalize the
// correction into a pattern the compiler can apply to future sources.
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

A user has noted a correction on a wiki article. Your job is to distill their correction into a structured prevention rule in WHEN/CHECK/BECAUSE form. The rule will be injected into future compile prompts so the compiler does not repeat the same mistake.

Structure:
- WHEN: the trigger condition. What situation or topic does this rule apply to? Generalize beyond the single article — "when writing about espresso extraction" not "when rewriting the espresso-extraction article".
- CHECK: the specific thing to verify. An observable, falsifiable condition. "Ensure yields are expressed in grams not milliliters."
- BECAUSE: the one-sentence rationale drawn from the user's correction.

Also produce 1-5 lowercase tags (one or two words each) that capture the domain of this rule. These drive relevance at compile time — rules are matched against the tags of the source/concept being written.

Rules for the rule:
- The WHEN clause must generalize. Do not mention the specific article slug or title.
- The CHECK clause must be actionable and verifiable by reading text. Avoid subjective checks like "make sure it sounds good".
- The BECAUSE clause is one sentence. Keep it terse.
- Tags are domain-relevant. If the user's correction is about coffee grinding methodology, use tags like ["coffee", "grinding"] — not ["correction"] or ["user"].
- Use the article's existing tags as a seed for domain if helpful, but don't blindly copy them.

Return ONLY valid JSON, no markdown fences.`

  const userPrompt =
    `## Article Title\n${opts.articleTitle}\n\n` +
    `## Article Tags\n${opts.articleTags.length ? opts.articleTags.join(", ") : "(none)"}\n\n` +
    `## Article Body\n${opts.articleContent.slice(0, 4_000)}\n\n` +
    `## User Correction\n${opts.correctionText}\n\n` +
    (opts.userTags.length ? `## User-Provided Tags\n${opts.userTags.join(", ")}\n\n` : "") +
    `## Output Format\n` +
    `{\n` +
    `  "when_condition": "When writing about ...",\n` +
    `  "check_condition": "Ensure that ...",\n` +
    `  "because": "Past corrections showed ...",\n` +
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
    const body = await res.text()
    return { error: body.slice(0, 500) }
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

    // Merge in user-provided tags so the user's explicit taxonomy takes
    // priority even if the model didn't pick it up.
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
