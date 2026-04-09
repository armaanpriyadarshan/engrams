// lint-engram — pluggable lint passes over an engram.
//
// Sprint 2.3 rewrite. The previous version was a single LLM call asking
// the model to find contradiction/drift/stale/unsupported/redundant all
// at once. That pattern had three problems: (1) everything was LLM cost
// so it couldn't run on every compile, (2) the model's output varied
// run-to-run so findings couldn't be reliably auto-resolved, (3) trivial
// issues like empty-content articles or missing wikilinks required an
// LLM to notice.
//
// The new architecture splits lint into two layers:
//
//   Deterministic layer (6 passes) — pure SQL + string analysis, runs
//   in ~50ms, zero LLM cost. Fires after every compile. Findings have
//   stable fingerprints and auto-resolve when no longer reproduced.
//
//     completeness — missing content / stub articles / empty tags
//     orphans      — articles with no edges either direction
//     connections  — prose mentions of other articles without wikilinks
//     style        — first-person / filler phrases / trailing whitespace
//     staleness    — article or source not touched in N days
//     impute       — null confidence / article_type / inconsistent slugs
//
//   Semantic layer (1 LLM pass) — contradiction / drift / redundancy.
//   Runs only on explicit request or scheduled invocation. Findings
//   don't auto-resolve because the LLM output varies.
//
//     semantic     — meaning-level cross-article checks
//
// Request shape:
//   { engram_id: uuid, mode?: 'deterministic' | 'full' | 'semantic' }
//
//     deterministic  — run the 6 fast passes only (default when
//                      fired by compile-source after every compile)
//     full           — run everything (deterministic + semantic)
//     semantic       — run only the LLM pass (cheapest way to
//                      manually refresh semantic findings)
//
// Response shape:
//   { findings_created, findings_resolved, by_pass, run_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type SupabaseClient = ReturnType<typeof createClient>

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

type Severity = "info" | "warning" | "error"
type LintMode = "deterministic" | "full" | "semantic"

interface ArticleRow {
  id: string
  slug: string
  title: string
  summary: string | null
  content_md: string | null
  confidence: number | null
  article_type: string | null
  tags: string[] | null
  source_ids: string[] | null
  related_slugs: string[] | null
  updated_at: string
}

interface EdgeRow {
  from_slug: string
  to_slug: string
  relation: string
}

interface SourceRow {
  id: string
  title: string | null
  updated_at: string
}

interface Finding {
  pass: string
  severity: Severity
  summary: string
  detail: string
  related_slugs: string[]
  fix_hint?: string
  /**
   * Stable fingerprint for dedup + auto-resolve. Null disables both
   * (used by the semantic LLM pass where output varies run to run).
   */
  fingerprint?: string | null
}

interface LintContext {
  engramId: string
  articles: ArticleRow[]
  edges: EdgeRow[]
  sources: SourceRow[]
  adjacency: Map<string, { in: Set<string>; out: Set<string> }>
  openaiKey: string | null
}

interface LintPass {
  name: string
  description: string
  deterministic: boolean
  run(ctx: LintContext): Promise<Finding[]>
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function fingerprint(pass: string, slugs: string[], keySuffix = ""): string {
  const sorted = [...slugs].sort().join(",")
  return `${pass}:${sorted}${keySuffix ? ":" + keySuffix : ""}`
}

function wordCount(s: string | null): number {
  if (!s) return 0
  return s.trim().split(/\s+/).filter(Boolean).length
}

function extractWikiLinks(md: string | null): Set<string> {
  if (!md) return new Set()
  const out = new Set<string>()
  for (const m of md.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) out.add(m[1])
  return out
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
}

function buildAdjacency(edges: EdgeRow[]): LintContext["adjacency"] {
  const adj: LintContext["adjacency"] = new Map()
  const ensure = (slug: string) => {
    if (!adj.has(slug)) adj.set(slug, { in: new Set(), out: new Set() })
    return adj.get(slug)!
  }
  for (const e of edges) {
    ensure(e.from_slug).out.add(e.to_slug)
    ensure(e.to_slug).in.add(e.from_slug)
  }
  return adj
}

// ───────────────────────────────────────────────────────────────
// Deterministic passes
// ───────────────────────────────────────────────────────────────

const completenessPass: LintPass = {
  name: "completeness",
  description: "Missing content, missing summaries, stub articles, empty tag sets.",
  deterministic: true,
  async run(ctx) {
    const out: Finding[] = []
    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue

      // Severity-graded: missing content is most serious, empty tags is info.
      if (!a.content_md || !a.content_md.trim()) {
        out.push({
          pass: "completeness",
          severity: "error",
          summary: `${a.title} has no content.`,
          detail: `The article ${a.slug} exists but its content_md is empty. Either feed a source that covers it or delete the stub.`,
          related_slugs: [a.slug],
          fix_hint: "Feed a source that covers this topic, or remove the empty stub.",
          fingerprint: fingerprint("completeness", [a.slug], "empty_content"),
        })
        continue
      }

      const wc = wordCount(a.content_md)
      if (wc < 20) {
        out.push({
          pass: "completeness",
          severity: "warning",
          summary: `${a.title} is a stub (${wc} words).`,
          detail: `The article ${a.slug} has only ${wc} words. Stubs make the wiki feel hollow. Either expand the coverage or merge it into a related article.`,
          related_slugs: [a.slug],
          fix_hint: "Feed more sources that cover this topic, or merge into a sibling.",
          fingerprint: fingerprint("completeness", [a.slug], "stub"),
        })
      }

      if (!a.summary || !a.summary.trim()) {
        out.push({
          pass: "completeness",
          severity: "info",
          summary: `${a.title} has no summary line.`,
          detail: `The article ${a.slug} is missing its one-sentence summary. Summaries show up in search results, the wiki list, and backlinks — missing ones make the surface feel incomplete.`,
          related_slugs: [a.slug],
          fix_hint: "Recompile the source to regenerate the summary.",
          fingerprint: fingerprint("completeness", [a.slug], "no_summary"),
        })
      }

      if (!a.tags || a.tags.length === 0) {
        out.push({
          pass: "completeness",
          severity: "info",
          summary: `${a.title} has no tags.`,
          detail: `Tags drive search filtering and prevention-rule matching. Articles without tags are harder to retrieve and miss relevant rules at compile time.`,
          related_slugs: [a.slug],
          fingerprint: fingerprint("completeness", [a.slug], "no_tags"),
        })
      }
    }
    return out
  },
}

const orphansPass: LintPass = {
  name: "orphans",
  description: "Articles with no connections in either direction.",
  deterministic: true,
  async run(ctx) {
    const out: Finding[] = []
    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue
      const neighbors = ctx.adjacency.get(a.slug)
      const inCount = neighbors?.in.size ?? 0
      const outCount = neighbors?.out.size ?? 0
      if (inCount === 0 && outCount === 0) {
        out.push({
          pass: "orphans",
          severity: "info",
          summary: `${a.title} is an orphan.`,
          detail: `The article ${a.slug} has no inbound or outbound edges. It isn't connected to the rest of the wiki and won't show up in neighborhood queries. Either cross-reference it from a related article or mark it for merge.`,
          related_slugs: [a.slug],
          fix_hint: "Add [[wikilinks]] from or to related articles on the next compile.",
          fingerprint: fingerprint("orphans", [a.slug]),
        })
      }
    }
    return out
  },
}

const connectionsPass: LintPass = {
  name: "connections",
  description: "Article titles mentioned in prose without [[wikilinks]].",
  deterministic: true,
  async run(ctx) {
    const out: Finding[] = []
    // Build a map of lowercase title → slug so we can detect prose
    // mentions. Title must be at least 4 chars and mostly alphanumeric
    // to avoid false positives on generic words.
    const titleMap = new Map<string, string>()
    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue
      const t = a.title.trim()
      if (t.length < 4) continue
      titleMap.set(t.toLowerCase(), a.slug)
    }

    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue
      if (!a.content_md) continue
      const lower = a.content_md.toLowerCase()
      const existingLinks = extractWikiLinks(a.content_md)
      const missingMentions = new Set<string>()
      for (const [title, targetSlug] of titleMap) {
        if (targetSlug === a.slug) continue
        if (existingLinks.has(targetSlug)) continue
        // Word-boundary check so "caffeine" doesn't match inside "decaffeinated".
        const pattern = new RegExp(`\\b${escapeRegex(title)}\\b`)
        if (pattern.test(lower)) {
          missingMentions.add(targetSlug)
        }
      }
      if (missingMentions.size > 0) {
        const missing = Array.from(missingMentions).slice(0, 6)
        out.push({
          pass: "connections",
          severity: "info",
          summary: `${a.title} mentions ${missing.length} other article${missing.length === 1 ? "" : "s"} without linking.`,
          detail: `The article ${a.slug} references these articles in prose but doesn't use [[wikilink]] syntax: ${missing.join(", ")}. Readers lose navigation; the graph loses edges.`,
          related_slugs: [a.slug, ...missing],
          fix_hint: "Wrap the inline mentions in [[slug]] on the next compile.",
          fingerprint: fingerprint("connections", [a.slug, ...missing]),
        })
      }
    }
    return out
  },
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const stylePass: LintPass = {
  name: "style",
  description: "First-person prose, filler phrases, and trailing whitespace.",
  deterministic: true,
  async run(ctx) {
    const out: Finding[] = []
    const firstPersonPattern = /\b(I|we|our|my|us)\b/
    const fillerPatterns = [
      /it is important to note/i,
      /it should be noted/i,
      /in conclusion,/i,
      /at the end of the day/i,
      /needless to say/i,
    ]

    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue
      if (!a.content_md) continue
      const problems: string[] = []

      if (firstPersonPattern.test(a.content_md)) {
        problems.push("first-person prose")
      }

      const fillerHits = fillerPatterns.filter((p) => p.test(a.content_md!))
      if (fillerHits.length > 0) {
        problems.push(`${fillerHits.length} filler phrase${fillerHits.length === 1 ? "" : "s"}`)
      }

      if (problems.length === 0) continue

      out.push({
        pass: "style",
        severity: "info",
        summary: `${a.title}: ${problems.join(", ")}.`,
        detail: `The article ${a.slug} drifts from the engrams voice (encyclopedic third-person, no filler). Problems: ${problems.join("; ")}.`,
        related_slugs: [a.slug],
        fix_hint: "Promote a prevention rule and recompile — the rule will nudge the LLM to avoid the pattern.",
        fingerprint: fingerprint("style", [a.slug], problems.join("|")),
      })
    }
    return out
  },
}

const stalenessPass: LintPass = {
  name: "staleness",
  description: "Articles or their sources haven't been updated in 90+ days.",
  deterministic: true,
  async run(ctx) {
    const out: Finding[] = []
    const STALE_DAYS = 90
    const sourceById = new Map(ctx.sources.map((s) => [s.id, s]))

    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue
      const articleAge = daysSince(a.updated_at)
      if (articleAge < STALE_DAYS) continue

      let oldestSourceDays = 0
      for (const sid of a.source_ids ?? []) {
        const s = sourceById.get(sid)
        if (!s) continue
        const age = daysSince(s.updated_at)
        if (age > oldestSourceDays) oldestSourceDays = age
      }

      const description =
        oldestSourceDays >= STALE_DAYS
          ? `Article and its sources are both over ${STALE_DAYS} days old. Either re-feed the source or accept the knowledge as stable.`
          : `Article hasn't been touched in ${Math.round(articleAge)} days though its sources are newer. A recompile could incorporate whatever drift happened.`

      out.push({
        pass: "staleness",
        severity: "info",
        summary: `${a.title} is stale (${Math.round(articleAge)}d).`,
        detail: description,
        related_slugs: [a.slug],
        fingerprint: fingerprint("staleness", [a.slug]),
      })
    }
    return out
  },
}

const imputePass: LintPass = {
  name: "impute",
  description: "Missing metadata that could be inferred — confidence, type, slug consistency.",
  deterministic: true,
  async run(ctx) {
    const out: Finding[] = []
    for (const a of ctx.articles) {
      if (a.article_type === "summary") continue

      if (a.confidence === null) {
        out.push({
          pass: "impute",
          severity: "info",
          summary: `${a.title} has no confidence score.`,
          detail: `The article ${a.slug} has a null confidence. The reader renders this as 0% and the heatmap treats it as low-confidence.`,
          related_slugs: [a.slug],
          fix_hint: "Recompile the source to have Pass B assign a confidence.",
          fingerprint: fingerprint("impute", [a.slug], "null_confidence"),
        })
      }

      if (!a.article_type) {
        out.push({
          pass: "impute",
          severity: "info",
          summary: `${a.title} has no article_type.`,
          detail: `The article ${a.slug} has a null article_type. It renders as "concept" by default but isn't classified in the wiki sections.`,
          related_slugs: [a.slug],
          fingerprint: fingerprint("impute", [a.slug], "null_type"),
        })
      }

      // Structural consistency: related_slugs should reflect content_md wikilinks.
      if (a.content_md && a.related_slugs) {
        const inProse = extractWikiLinks(a.content_md)
        const inArray = new Set(a.related_slugs)
        const missing: string[] = []
        for (const slug of inProse) {
          if (slug !== a.slug && !inArray.has(slug)) missing.push(slug)
        }
        if (missing.length > 0) {
          out.push({
            pass: "impute",
            severity: "info",
            summary: `${a.title}: related_slugs misses ${missing.length} wikilink target${missing.length === 1 ? "" : "s"}.`,
            detail: `The article ${a.slug} has [[wikilinks]] in its content_md that aren't reflected in the related_slugs array: ${missing.slice(0, 5).join(", ")}. Backlinks computed from related_slugs will miss these.`,
            related_slugs: [a.slug, ...missing],
            fingerprint: fingerprint("impute", [a.slug, ...missing], "related_slugs_drift"),
          })
        }
      }
    }
    return out
  },
}

// ───────────────────────────────────────────────────────────────
// Semantic LLM pass
// ───────────────────────────────────────────────────────────────

const semanticPass: LintPass = {
  name: "semantic",
  description: "Cross-article contradiction, drift, and redundancy — requires an LLM.",
  deterministic: false,
  async run(ctx): Promise<Finding[]> {
    if (!ctx.openaiKey) return []
    if (ctx.articles.length < 2) return []

    // Build a compact article corpus for the LLM. Cap each article's
    // body so we don't blow the prompt budget with one huge article.
    const corpus = ctx.articles
      .filter((a) => a.article_type !== "summary")
      .slice(0, 40)
      .map((a) => {
        const conf = Math.round((a.confidence ?? 0) * 100)
        const body = (a.content_md ?? "").slice(0, 900)
        return `## ${a.title} (${a.slug}, ${conf}% confidence)\n${body}`
      })
      .join("\n\n---\n\n")

    const systemPrompt = `You are a knowledge base quality linter for Engrams.

You will read a set of wiki articles and flag three kinds of semantic problems that deterministic checks cannot catch:

- contradiction: two articles make claims that cannot both be true. Cite the specific claims.
- drift: an article's content has drifted from what its title or summary promises. The title says one thing, the body covers another.
- redundant: two articles cover substantially the same ground at the same level of detail. They should probably merge.

For each finding, emit:
- finding_type: one of contradiction, drift, redundant
- severity: info, warning, or error
- summary: a single sentence naming the issue
- detail: the specific evidence with slug references
- related_slugs: the article slugs involved (usually two)

Be precise. Do not flag articles that are merely related or share vocabulary. Do not invent contradictions that aren't there. Two to six findings is typical for a healthy wiki; zero is fine for a small one.

Return ONLY valid JSON, no markdown fences.`

    const userPrompt =
      `## Articles\n\n${corpus}\n\n## Output Format\n{\n  "findings": [\n    { "finding_type": "contradiction", "severity": "warning", "summary": "...", "detail": "...", "related_slugs": ["a", "b"] }\n  ]\n}`

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ctx.openaiKey}`,
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

    if (!res.ok) {
      console.error("[lint-engram] semantic pass LLM call failed", await res.text())
      return []
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return []

    try {
      const parsed = JSON.parse(content) as {
        findings?: Array<{
          finding_type?: string
          severity?: string
          summary?: string
          detail?: string
          related_slugs?: string[]
        }>
      }
      const out: Finding[] = []
      const allowed = new Set(["contradiction", "drift", "redundant"])
      for (const f of parsed.findings ?? []) {
        if (!f.finding_type || !allowed.has(f.finding_type)) continue
        if (!f.summary || !f.detail) continue
        const sev: Severity =
          f.severity === "error" || f.severity === "warning" ? f.severity : "info"
        out.push({
          pass: f.finding_type,
          severity: sev,
          summary: f.summary,
          detail: f.detail,
          related_slugs: Array.isArray(f.related_slugs) ? f.related_slugs.slice(0, 6) : [],
          fingerprint: null, // LLM output varies — no auto-resolve
        })
      }
      return out
    } catch (err) {
      console.error("[lint-engram] semantic pass parse error", err)
      return []
    }
  },
}

const DETERMINISTIC_PASSES: LintPass[] = [
  completenessPass,
  orphansPass,
  connectionsPass,
  stylePass,
  stalenessPass,
  imputePass,
]

// ───────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
  const startedAt = Date.now()
  let agentRunId: string | null = null

  const finishRun = async (
    status: "completed" | "failed",
    summary: string,
    detail: Record<string, unknown> = {},
  ) => {
    if (!agentRunId) return
    const { error } = await supabase
      .from("agent_runs")
      .update({
        status,
        summary: summary.slice(0, 300),
        detail,
        duration_ms: Date.now() - startedAt,
        finished_at: new Date().toISOString(),
      })
      .eq("id", agentRunId)
    if (error) console.error("[lint-engram] finishRun error", error)
  }

  try {
    const body = await req.json()
    const engram_id: string = body.engram_id
    const mode: LintMode =
      body.mode === "full" || body.mode === "semantic" || body.mode === "deterministic"
        ? body.mode
        : "deterministic"

    if (!engram_id) {
      return json({ error: "engram_id required" }, 400)
    }

    const { data: openaiKey } = await supabase.rpc("get_openai_key")

    // Agent run row for live activity surfaces.
    const { data: runRow } = await supabase
      .from("agent_runs")
      .insert({
        engram_id,
        agent_type: "lint",
        status: "running",
        detail: { mode },
      })
      .select("id")
      .single()
    agentRunId = runRow?.id ?? null

    // Load the engram context once.
    const [articlesRes, edgesRes, sourcesRes] = await Promise.all([
      supabase
        .from("articles")
        .select(
          "id, slug, title, summary, content_md, confidence, article_type, tags, source_ids, related_slugs, updated_at",
        )
        .eq("engram_id", engram_id),
      supabase
        .from("edges")
        .select("from_slug, to_slug, relation")
        .eq("engram_id", engram_id),
      supabase
        .from("sources")
        .select("id, title, updated_at")
        .eq("engram_id", engram_id),
    ])

    const articles = (articlesRes.data ?? []) as ArticleRow[]
    const edges = (edgesRes.data ?? []) as EdgeRow[]
    const sources = (sourcesRes.data ?? []) as SourceRow[]
    const adjacency = buildAdjacency(edges)

    const ctx: LintContext = {
      engramId: engram_id,
      articles,
      edges,
      sources,
      adjacency,
      openaiKey: (openaiKey as string | null) ?? null,
    }

    // Decide which passes to run based on mode.
    const passes: LintPass[] =
      mode === "deterministic"
        ? DETERMINISTIC_PASSES
        : mode === "semantic"
        ? [semanticPass]
        : [...DETERMINISTIC_PASSES, semanticPass]

    // Run deterministic passes in parallel, LLM pass last (sequential).
    const determ = passes.filter((p) => p.deterministic)
    const semantic = passes.filter((p) => !p.deterministic)

    const determResults = await Promise.all(determ.map((p) => p.run(ctx).catch((e) => {
      console.error(`[lint-engram] pass ${p.name} failed`, e)
      return [] as Finding[]
    })))
    const semanticResults: Finding[][] = []
    for (const p of semantic) {
      try {
        semanticResults.push(await p.run(ctx))
      } catch (e) {
        console.error(`[lint-engram] pass ${p.name} failed`, e)
        semanticResults.push([])
      }
    }

    const allFindings: Finding[] = [...determResults.flat(), ...semanticResults.flat()]

    // Fetch existing open findings so we can dedup by fingerprint and
    // auto-resolve the ones that weren't reproduced this run.
    const { data: existingOpen } = await supabase
      .from("lint_findings")
      .select("id, finding_type, fingerprint")
      .eq("engram_id", engram_id)
      .eq("status", "open")

    const existingByFingerprint = new Map<string, string>()
    for (const row of (existingOpen ?? []) as { id: string; finding_type: string; fingerprint: string | null }[]) {
      if (row.fingerprint) existingByFingerprint.set(row.fingerprint, row.id)
    }

    const producedFingerprints = new Set<string>()
    const rowsToInsert: Record<string, unknown>[] = []

    for (const f of allFindings) {
      if (f.fingerprint) {
        producedFingerprints.add(f.fingerprint)
        if (existingByFingerprint.has(f.fingerprint)) {
          // Already open under the same fingerprint — leave it alone.
          continue
        }
      }
      rowsToInsert.push({
        engram_id,
        finding_type: f.pass,
        summary: f.summary.slice(0, 500),
        detail: f.detail.slice(0, 2000),
        related_slugs: f.related_slugs,
        severity: f.severity,
        status: "open",
        fingerprint: f.fingerprint ?? null,
        fix_hint: f.fix_hint ?? null,
        run_id: agentRunId,
      })
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("lint_findings").insert(rowsToInsert)
      if (insErr) console.error("[lint-engram] insert error", insErr)
    }

    // Auto-resolve: any existing open deterministic finding whose
    // fingerprint wasn't produced this run is no longer a real issue
    // in the current state of the engram. Flip it to resolved. We only
    // do this for passes we actually ran this invocation — running
    // only deterministic passes shouldn't resolve stale LLM findings.
    const autoResolveIds: string[] = []
    const ranPassNames = new Set(passes.map((p) => p.name))
    // Expand semantic pass name to the three finding_types it produces.
    if (ranPassNames.has("semantic")) {
      ranPassNames.add("contradiction")
      ranPassNames.add("drift")
      ranPassNames.add("redundant")
    }
    for (const row of (existingOpen ?? []) as {
      id: string
      finding_type: string
      fingerprint: string | null
    }[]) {
      if (!row.fingerprint) continue // LLM findings have no fingerprint; don't auto-resolve
      if (!ranPassNames.has(row.finding_type)) continue // this run didn't cover the pass that produced it
      if (producedFingerprints.has(row.fingerprint)) continue // still reproduced
      autoResolveIds.push(row.id)
    }

    if (autoResolveIds.length > 0) {
      await supabase
        .from("lint_findings")
        .update({
          status: "resolved",
          resolved_reason: "not_reproduced",
          resolved_at: new Date().toISOString(),
        })
        .in("id", autoResolveIds)
    }

    const byPass: Record<string, number> = {}
    for (const f of allFindings) byPass[f.pass] = (byPass[f.pass] ?? 0) + 1

    const summaryLine =
      rowsToInsert.length === 0 && autoResolveIds.length === 0
        ? "No new findings."
        : `${rowsToInsert.length} new, ${autoResolveIds.length} auto-resolved.`

    await finishRun("completed", summaryLine, {
      mode,
      by_pass: byPass,
      findings_created: rowsToInsert.length,
      findings_resolved: autoResolveIds.length,
    })

    return json({
      findings_created: rowsToInsert.length,
      findings_resolved: autoResolveIds.length,
      by_pass: byPass,
      run_id: agentRunId,
      mode,
    })
  } catch (err) {
    await finishRun("failed", String(err).slice(0, 300), { error: String(err) })
    return json({ error: String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
