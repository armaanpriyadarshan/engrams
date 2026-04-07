# Feed Pipeline Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix file parsing, URL extraction, feed progress UI, and source dedup/count accuracy across the feed pipeline.

**Architecture:** Two Supabase Edge Functions are modified (`parse-file`, `compile-source`) and one frontend file (`feed/page.tsx`). Edge Functions are not version-controlled locally — they're deployed via the Supabase MCP tools (`mcp__claude_ai_Supabase__deploy_edge_function`). The frontend file is in the git repo.

**Tech Stack:** Deno (Edge Functions), `unpdf` (PDF), `mammoth` (DOCX), `JSZip` (PPTX/XLSX), `@mozilla/readability` + `linkedom` (URL), Supabase Realtime (progress), Next.js/React (frontend)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `parse-file` Edge Function | Rewrite | Extract text from PDF, DOCX, PPTX, XLSX, CSV, TXT |
| `compile-source` Edge Function | Modify | URL extraction via Readability, progress stage updates, source recount |
| `apps/web/app/app/[engram]/feed/page.tsx` | Modify | Dedup checks, Realtime progress subscription, remove premature count increment |

---

### Task 1: Rewrite `parse-file` Edge Function

**Files:**
- Deploy: `parse-file` Edge Function via Supabase MCP

**Current state:** The deployed function uses regex-based extraction that fails on most real files. Full source was retrieved via `mcp__claude_ai_Supabase__get_edge_function` earlier in this session.

- [ ] **Step 1: Deploy the rewritten `parse-file` Edge Function**

Deploy via `mcp__claude_ai_Supabase__deploy_edge_function` with project_id `edrlhkcnkfsypdzffhle`, function_slug `parse-file`, and this `index.ts`:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { extractText, getDocumentProxy } from "npm:unpdf"
import mammoth from "npm:mammoth"
import JSZip from "npm:jszip"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { file_base64, filename, format } = body

    if (!file_base64 || !format) {
      return new Response(JSON.stringify({ error: "file_base64 and format required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const binaryStr = atob(file_base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

    let content = ""

    if (format === "pdf") {
      content = await extractPDF(bytes)
    } else if (format === "docx") {
      content = await extractDOCX(bytes)
    } else if (format === "pptx") {
      content = await extractPPTX(bytes)
    } else if (format === "xlsx") {
      content = await extractXLSX(bytes)
    } else {
      // CSV, TXT, MD — decode as text
      content = new TextDecoder().decode(bytes)
    }

    if (!content.trim()) {
      return new Response(JSON.stringify({ error: "Could not extract text from file" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ content: content.slice(0, 100000), filename }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

async function extractPDF(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

async function extractDOCX(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
  return result.value
}

async function extractPPTX(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0")
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0")
      return numA - numB
    })

  const parts: string[] = []
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)!.async("text")
    const texts: string[] = []
    for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) {
      texts.push(m[1])
    }
    if (texts.length > 0) parts.push(texts.join(" "))
  }
  return parts.join("\n\n")
}

async function extractXLSX(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)

  // Parse shared strings table
  const sharedStrings: string[] = []
  const ssFile = zip.file("xl/sharedStrings.xml")
  if (ssFile) {
    const ssXml = await ssFile.async("text")
    for (const m of ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) {
      sharedStrings.push(m[1])
    }
  }

  // Parse worksheets
  const sheetFiles = Object.keys(zip.files)
    .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/sheet(\d+)/)?.[1] ?? "0")
      const numB = parseInt(b.match(/sheet(\d+)/)?.[1] ?? "0")
      return numA - numB
    })

  const parts: string[] = []
  for (const sheetFile of sheetFiles) {
    const xml = await zip.file(sheetFile)!.async("text")
    const rows: string[] = []

    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      const rowXml = rowMatch[1]

      for (const cellMatch of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1]
        const cellContent = cellMatch[2]
        const valueMatch = cellContent.match(/<v>([^<]*)<\/v>/)
        if (!valueMatch) continue

        const value = valueMatch[1]
        // t="s" means shared string reference
        if (attrs.includes('t="s"')) {
          const idx = parseInt(value)
          cells.push(sharedStrings[idx] ?? value)
        } else {
          cells.push(value)
        }
      }
      if (cells.length > 0) rows.push(cells.join("\t"))
    }
    if (rows.length > 0) parts.push(rows.join("\n"))
  }
  return parts.join("\n\n")
}
```

- [ ] **Step 2: Test with a real PDF**

Upload a real PDF via the feed page. Verify:
- The source is created with `status: "pending"`
- Content is extracted (check `sources.content_md` in Supabase)
- Compilation produces articles

- [ ] **Step 3: Test with a real DOCX**

Upload a real DOCX via the feed page. Same verification as Step 2.

---

### Task 2: Update `compile-source` — URL Extraction + Progress Stages + Source Recount

**Files:**
- Deploy: `compile-source` Edge Function via Supabase MCP

**Current state:** The full deployed source was retrieved earlier. Three changes: (a) replace regex HTML stripping with Readability, (b) add stage updates to `compilation_runs.log`, (c) add source recount alongside existing article recount.

- [ ] **Step 1: Deploy the updated `compile-source` Edge Function**

Deploy via `mcp__claude_ai_Supabase__deploy_edge_function` with project_id `edrlhkcnkfsypdzffhle`, function_slug `compile-source`, and this `index.ts`:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { Readability } from "npm:@mozilla/readability"
import { parseHTML } from "npm:linkedom"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { source_id } = await req.json()
    if (!source_id) {
      return new Response(JSON.stringify({ error: "source_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const { data: openaiKey } = await supabase.rpc('get_openai_key')
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: source, error: sourceErr } = await supabase
      .from("sources")
      .select("*")
      .eq("id", source_id)
      .single()

    if (sourceErr || !source) {
      return new Response(JSON.stringify({ error: "Source not found", detail: sourceErr }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Create compilation run early so frontend can subscribe
    const { data: run } = await supabase
      .from("compilation_runs")
      .insert({
        engram_id: source.engram_id,
        source_id: source_id,
        trigger_type: "feed",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    const updateStage = async (stage: string) => {
      await supabase.from("compilation_runs")
        .update({ log: { stage } })
        .eq("id", run?.id)
    }

    let content = source.content_md ?? ""

    // --- URL fetching with Readability ---
    if (source.source_type === "url" && source.source_url && !content) {
      await updateStage("fetching")
      try {
        const res = await fetch(source.source_url, {
          headers: { "User-Agent": "Engrams/1.0 (knowledge compiler)" },
        })
        const html = await res.text()

        // Try Readability first
        const { document } = parseHTML(html)
        const reader = new Readability(document)
        const article = reader.parse()

        if (article?.textContent && article.textContent.trim().length > 50) {
          content = article.textContent.trim()
          // Use article title if source has no meaningful title
          if (article.title && (!source.title || source.title === source.source_url)) {
            await supabase.from("sources").update({ title: article.title }).eq("id", source_id)
          }
        } else {
          // Fallback: regex strip
          content = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, " ")
            .trim()
        }

        if (content.length > 50) {
          await supabase
            .from("sources")
            .update({ content_md: content.slice(0, 50000) })
            .eq("id", source_id)
        } else {
          await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
          await supabase.from("compilation_runs").update({
            status: "failed",
            log: { stage: "fetching", error: "Could not extract content from this URL" },
            finished_at: new Date().toISOString(),
          }).eq("id", run?.id)
          return new Response(JSON.stringify({ error: "Could not extract content from this URL" }), {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      } catch {
        await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
        await supabase.from("compilation_runs").update({
          status: "failed",
          log: { stage: "fetching", error: "Failed to fetch URL" },
          finished_at: new Date().toISOString(),
        }).eq("id", run?.id)
        return new Response(JSON.stringify({ error: "Failed to fetch URL" }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    if (!content.trim()) {
      await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
      await supabase.from("compilation_runs").update({
        status: "failed",
        log: { stage: "compiling", error: "No content to compile" },
        finished_at: new Date().toISOString(),
      }).eq("id", run?.id)
      return new Response(JSON.stringify({ error: "No content to compile" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // --- Compilation ---
    await updateStage("compiling")

    const truncated = content.slice(0, 24000)

    const { data: existingArticles } = await supabase
      .from("articles")
      .select("slug, title, summary")
      .eq("engram_id", source.engram_id)

    const existingSlugSet = new Set((existingArticles ?? []).map((a: any) => a.slug))
    const wikiIndex = (existingArticles ?? []).map(
      (a: any) => `- ${a.slug}: ${a.title}${a.summary ? " \u2014 " + a.summary : ""}`
    ).join("\n")

    const systemPrompt = `You are a knowledge compiler for a wiki system called Engrams. Given a source document and an existing wiki index, extract the key concepts and produce structured wiki articles.

Rules:
- Each article covers ONE concept or topic. Prefer depth over breadth.
- Use [[slug]] syntax to link between articles in content_md (both new articles you're creating and existing ones from the wiki index).
- Slugs are kebab-case (e.g., "machine-learning", "neural-networks").
- If an existing article in the wiki index covers the same topic, mark it as "update" with the SAME slug. Otherwise "create" with a new slug.
- Write in clear, encyclopedic prose. No first person. No hedging. No "it is important to note".
- Assign confidence 0.0-1.0 based on how well the source supports the claims.
- article_type is "concept" for standalone topics or "synthesis" for articles that tie multiple concepts together.
- Tags should be lowercase, 1-2 words each.

CRITICAL — EDGES:
- You MUST populate the edges array. For every new article, create at least one edge to an existing wiki article whenever there is any conceptual relationship — shared domain, prerequisite knowledge, contrasting approaches, related techniques, etc.
- Use these relations: "related" (general connection), "extends" (builds on), "contradicts" (conflicts with), "requires" (prerequisite), "part_of" (is a sub-topic of).
- Do not invent slugs that don't exist. Edges must reference either a slug from the wiki index or a slug you are creating in this same compilation.
- If the wiki index is empty, no edges are required.
- If the wiki index is non-empty, you should produce roughly one edge per existing article that shares any topic overlap with the new article. Err on the side of more edges.

- IMPORTANT: Also identify unresolved questions \u2014 things this source raises, references, or explicitly leaves open that are NOT answered in the source or the existing wiki. These should be genuine research questions, not trivial gaps.

Return ONLY valid JSON, no markdown fences.`

    const userPrompt = `## Source Title\n${source.title ?? "Untitled"}\n\n## Source Content\n${truncated}\n\n## Existing Wiki Index\n${wikiIndex || "(empty - this is the first source)"}\n\n## Output Format\n{\n  "articles": [\n    {\n      "action": "create" | "update",\n      "slug": "kebab-case-slug",\n      "title": "Article Title",\n      "summary": "One-sentence summary.",\n      "content_md": "Full article in markdown. Use [[slug]] to link.",\n      "tags": ["tag1", "tag2"],\n      "confidence": 0.85,\n      "article_type": "concept"\n    }\n  ],\n  "edges": [\n    { "from_slug": "slug-a", "to_slug": "slug-b", "relation": "related" }\n  ],\n  "unresolved_questions": [\n    "What specific mechanism causes X to affect Y?"\n  ]\n}`

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
      const errBody = await openaiRes.text()
      await supabase.from("compilation_runs").update({
        status: "failed",
        log: { stage: "compiling", error: errBody },
        finished_at: new Date().toISOString(),
      }).eq("id", run?.id)
      await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
      return new Response(JSON.stringify({ error: "OpenAI API error", detail: errBody }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const openaiData = await openaiRes.json()
    const result = JSON.parse(openaiData.choices[0].message.content)

    // --- Writing articles and edges ---
    await updateStage("writing")

    const newSlugSet = new Set<string>(existingSlugSet)
    for (const a of (result.articles ?? [])) {
      if (a.slug) newSlugSet.add(a.slug)
    }

    const extractWikiLinks = (md: string): string[] => {
      const matches = md.matchAll(/\[\[([a-z0-9-]+)\]\]/g)
      const slugs = new Set<string>()
      for (const m of matches) slugs.add(m[1])
      return Array.from(slugs)
    }

    let articlesCreated = 0
    let articlesUpdated = 0

    for (const article of result.articles ?? []) {
      const linkedSlugs = extractWikiLinks(article.content_md ?? "")
        .filter(s => s !== article.slug && newSlugSet.has(s))

      if (article.action === "update") {
        const { data: existing } = await supabase
          .from("articles")
          .select("id, source_ids, related_slugs")
          .eq("engram_id", source.engram_id)
          .eq("slug", article.slug)
          .single()

        if (existing) {
          const sourceIds = [...new Set([...(existing.source_ids ?? []), source_id])]
          const relatedSlugs = [...new Set([
            ...(existing.related_slugs ?? []),
            ...linkedSlugs,
          ])]

          await supabase
            .from("articles")
            .update({
              title: article.title,
              summary: article.summary,
              content_md: article.content_md,
              confidence: article.confidence,
              article_type: article.article_type,
              tags: article.tags,
              source_ids: sourceIds,
              related_slugs: relatedSlugs,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id)

          articlesUpdated++
        } else {
          article.action = "create"
        }
      }

      if (article.action === "create") {
        await supabase.from("articles").insert({
          engram_id: source.engram_id,
          slug: article.slug,
          title: article.title,
          summary: article.summary,
          content_md: article.content_md,
          confidence: article.confidence,
          article_type: article.article_type ?? "concept",
          tags: article.tags ?? [],
          source_ids: [source_id],
          related_slugs: linkedSlugs,
        })

        articlesCreated++
      }
    }

    const edgeSet = new Set<string>()
    let edgesCreated = 0
    const insertEdge = async (from_slug: string, to_slug: string, relation: string) => {
      if (from_slug === to_slug) return
      if (!newSlugSet.has(from_slug) || !newSlugSet.has(to_slug)) return
      const key = `${from_slug}|${to_slug}|${relation}`
      if (edgeSet.has(key)) return
      edgeSet.add(key)
      const { error: edgeErr } = await supabase.from("edges").insert({
        engram_id: source.engram_id,
        from_slug,
        to_slug,
        relation,
        weight: 1.0,
      })
      if (!edgeErr) edgesCreated++
    }

    for (const edge of result.edges ?? []) {
      await insertEdge(edge.from_slug, edge.to_slug, edge.relation ?? "related")
    }

    for (const article of result.articles ?? []) {
      if (!article.slug || !article.content_md) continue
      const linkedSlugs = extractWikiLinks(article.content_md)
      for (const target of linkedSlugs) {
        if (target === article.slug) continue
        if (!newSlugSet.has(target)) continue
        await insertEdge(article.slug, target, "related")
      }
    }

    const unresolvedQuestions = result.unresolved_questions ?? []
    if (unresolvedQuestions.length > 0) {
      await supabase.from("sources").update({ unresolved_questions: unresolvedQuestions }).eq("id", source_id)
    }

    await supabase.from("compilation_runs").update({
      status: "completed",
      articles_created: articlesCreated,
      articles_updated: articlesUpdated,
      edges_created: edgesCreated,
      log: { stage: "completed", articles: result.articles?.length ?? 0, edges: edgesCreated, unresolved_questions: unresolvedQuestions.length },
      finished_at: new Date().toISOString(),
    }).eq("id", run?.id)

    await supabase.from("sources").update({ status: "compiled" }).eq("id", source_id)

    // --- Recount both articles AND sources ---
    const { count: articleCount } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", source.engram_id)

    const { count: sourceCount } = await supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", source.engram_id)
      .eq("status", "compiled")

    await supabase
      .from("engrams")
      .update({ article_count: articleCount ?? 0, source_count: sourceCount ?? 0 })
      .eq("id", source.engram_id)

    return new Response(JSON.stringify({
      articles_created: articlesCreated,
      articles_updated: articlesUpdated,
      edges_created: edgesCreated,
      unresolved_questions: unresolvedQuestions.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
```

- [ ] **Step 2: Test URL extraction**

Feed a URL (e.g., a Wikipedia article or blog post) via the feed page. Verify:
- Content is extracted via Readability (check `sources.content_md`)
- Compilation produces articles
- Source marked as `"compiled"`

- [ ] **Step 3: Test URL failure case**

Feed a known-bad URL (e.g., an SPA with no server rendering, or a nonexistent domain). Verify:
- Source is marked as `"failed"`
- Compilation run status is `"failed"` with error in log
- Frontend shows error message

---

### Task 3: Update Feed Page — Dedup, Progress, Count Fix

**Files:**
- Modify: `apps/web/app/app/[engram]/feed/page.tsx`

- [ ] **Step 1: Rewrite feed/page.tsx**

Replace the entire file with this implementation that adds dedup checks, Realtime progress subscription, and removes the premature `increment_source_count`:

```typescript
"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { createSnapshot } from "@/lib/snapshots"

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export default function FeedPage() {
  const params = useParams()
  const router = useRouter()
  const engramSlug = params.engram as string

  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [activeTab, setActiveTab] = useState<"url" | "text" | "file">("url")
  const [submitting, setSubmitting] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [message, setMessage] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null)

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      channelRef.current?.unsubscribe()
    }
  }, [])

  const subscribeToCompilation = useCallback((supabase: ReturnType<typeof createClient>, sourceId: string, engramId: string) => {
    setCompiling(true)
    setMessage("Source added. Compiling...")

    const channel = supabase
      .channel(`compilation-${sourceId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "compilation_runs",
        filter: `source_id=eq.${sourceId}`,
      }, async (payload) => {
        const run = payload.new as any
        const stage = run.log?.stage

        if (run.status === "completed") {
          const created = run.articles_created ?? 0
          const updated = run.articles_updated ?? 0
          const edges = run.edges_created ?? 0
          setMessage(`Compilation complete. ${created} created. ${updated} updated. ${edges} connections found.`)
          setCompiling(false)
          channel.unsubscribe()
          channelRef.current = null
          await createSnapshot(supabase, engramId, "feed", `${created} created. ${updated} updated.`, {
            articles_created: created,
            articles_updated: updated,
            edges_created: edges,
          }, sourceId)
          supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
          supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: sourceId } })
          supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
          router.refresh()
        } else if (run.status === "failed") {
          const error = run.log?.error ?? "Compilation failed."
          setMessage(error)
          setCompiling(false)
          channel.unsubscribe()
          channelRef.current = null
        } else if (stage === "fetching") {
          setMessage("Fetching content...")
        } else if (stage === "compiling") {
          setMessage("Compiling...")
        } else if (stage === "writing") {
          setMessage("Writing articles...")
        }
      })
      .subscribe()

    channelRef.current = channel
  }, [router])

  const triggerCompilation = useCallback((supabase: ReturnType<typeof createClient>, sourceId: string, engramId: string) => {
    subscribeToCompilation(supabase, sourceId, engramId)
    // Fire and forget — progress comes via Realtime
    supabase.functions.invoke("compile-source", { body: { source_id: sourceId } })
  }, [subscribeToCompilation])

  const submit = useCallback(async (sourceType: string, content: string, title?: string) => {
    if (!content.trim()) return
    setSubmitting(true)
    setMessage("")

    const supabase = createClient()

    const { data: engram } = await supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()

    if (!engram) { setMessage("Engram not found."); setSubmitting(false); return }

    // --- Dedup checks ---
    if (sourceType === "url") {
      const { data: existing } = await supabase
        .from("sources")
        .select("id")
        .eq("engram_id", engram.id)
        .eq("source_url", content.trim())
        .limit(1)
        .maybeSingle()

      if (existing) {
        await supabase.from("sources").update({
          content_md: null,
          status: "pending",
        }).eq("id", existing.id)
        setUrl("")
        setSubmitting(false)
        setMessage("Source updated. Recompiling...")
        triggerCompilation(supabase, existing.id, engram.id)
        return
      }
    } else {
      // Text or file
      const hash = await sha256(content.trim())
      const sourceTitle = title ?? content.trim().slice(0, 80)

      // Check by filename/title first (for files)
      if (title) {
        const { data: existing } = await supabase
          .from("sources")
          .select("id, content_hash")
          .eq("engram_id", engram.id)
          .eq("title", title)
          .limit(1)
          .maybeSingle()

        if (existing) {
          if (existing.content_hash === hash) {
            setMessage("This content has not changed.")
            setSubmitting(false)
            return
          }
          // Same file, new content — update and recompile
          await supabase.from("sources").update({
            content_md: content.trim(),
            content_hash: hash,
            status: "pending",
          }).eq("id", existing.id)
          setText("")
          setSubmitting(false)
          setMessage("Source updated. Recompiling...")
          triggerCompilation(supabase, existing.id, engram.id)
          return
        }
      } else {
        // Pure text — check by content hash
        const { data: existing } = await supabase
          .from("sources")
          .select("id")
          .eq("engram_id", engram.id)
          .eq("content_hash", hash)
          .limit(1)
          .maybeSingle()

        if (existing) {
          setMessage("This content has already been fed.")
          setSubmitting(false)
          return
        }
      }

      // New source — insert with hash
      const { data: source, error } = await supabase.from("sources").insert({
        engram_id: engram.id,
        source_type: sourceType,
        source_url: null,
        content_md: content.trim(),
        content_hash: hash,
        title: sourceTitle,
        status: "pending",
      }).select("id").single()

      if (error || !source) {
        setMessage("Failed to add source.")
        setSubmitting(false)
        return
      }

      setUrl("")
      setText("")
      setSubmitting(false)
      triggerCompilation(supabase, source.id, engram.id)
      return
    }

    // New URL source — insert without hash (content not fetched yet)
    const { data: source, error } = await supabase.from("sources").insert({
      engram_id: engram.id,
      source_type: sourceType,
      source_url: content.trim(),
      content_md: null,
      title: content.trim(),
      status: "pending",
    }).select("id").single()

    if (error || !source) {
      setMessage("Failed to add source.")
      setSubmitting(false)
      return
    }

    setUrl("")
    setText("")
    setSubmitting(false)
    triggerCompilation(supabase, source.id, engram.id)
  }, [engramSlug, triggerCompilation])

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    const name = file.name.replace(/\.[^.]+$/, "")
    const binaryFormats = ["pdf", "docx", "pptx", "xlsx"]

    if (binaryFormats.includes(ext)) {
      setSubmitting(true)
      setMessage("Parsing...")
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)

      const supabase = createClient()
      const { data: parsed, error: parseError } = await supabase.functions.invoke("parse-file", {
        body: { file_base64: base64, filename: file.name, format: ext },
      })

      if (parseError || !parsed?.content) {
        setMessage("Could not parse file.")
        setSubmitting(false)
        return
      }

      setSubmitting(false)
      submit("text", parsed.content, name)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        if (content) submit("text", content, name)
      }
      reader.readAsText(file)
    }
  }, [submit])

  const tabs = [
    { id: "url" as const, label: "URL" },
    { id: "text" as const, label: "Text" },
    { id: "file" as const, label: "File" },
  ]

  return (
    <div className="max-w-xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Feed</h1>

      <div className="flex gap-4 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs font-mono transition-colors duration-120 cursor-pointer ${
              activeTab === tab.id ? "text-text-emphasis" : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "url" && (
        <div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit("url", url) }}
            placeholder="Paste a URL"
            className="w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary font-mono placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
          />
          <button
            onClick={() => submit("url", url)}
            disabled={submitting || compiling || !url.trim()}
            className="mt-4 bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120"
          >
            {submitting ? "Adding..." : "Feed"}
          </button>
        </div>
      )}

      {activeTab === "text" && (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text, notes, or content"
            rows={8}
            className="w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms] resize-none"
          />
          <button
            onClick={() => submit("text", text)}
            disabled={submitting || compiling || !text.trim()}
            className="mt-4 bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120"
          >
            {submitting ? "Adding..." : "Feed"}
          </button>
        </div>
      )}

      {activeTab === "file" && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const file = e.dataTransfer.files[0]
              if (file) handleFile(file)
            }}
            onClick={() => fileRef.current?.click()}
            className={`border border-dashed px-6 py-16 text-center cursor-pointer transition-all duration-180 ease-out ${
              isDragging
                ? "border-border-emphasis bg-surface-raised"
                : "border-border hover:border-border-emphasis"
            }`}
          >
            <p className={`text-sm ${isDragging ? "text-text-secondary" : "text-text-tertiary"}`}>
              {isDragging ? "Drop to feed." : "Drop a file or click to choose."}
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf,.docx,.pptx,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ""
            }}
          />
          <p className="mt-3 text-[10px] font-mono text-text-ghost">PDF, DOCX, PPTX, TXT, MD, CSV</p>
        </div>
      )}

      {message && (
        <p className={`mt-4 text-xs ${compiling ? "text-agent-active" : "text-text-tertiary"}`}>{message}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify dedup — URL re-feed**

Feed the same URL twice. On the second feed:
- No new source row is created
- Existing source is reset to `"pending"` and recompiled
- Message shows "Source updated. Recompiling..."
- Source count in sidebar does not double

- [ ] **Step 3: Verify dedup — identical text**

Paste the same text twice. On the second paste:
- Message shows "This content has already been fed."
- No new source row, no compilation triggered

- [ ] **Step 4: Verify dedup — file update**

Upload a file, then upload a file with the same name but different content:
- Existing source is updated with new content
- Message shows "Source updated. Recompiling..."
- Upload the same file again with identical content: "This content has not changed."

- [ ] **Step 5: Verify progress stages**

Feed a new URL or text. Verify the message cycles through:
- "Fetching content..." (URLs only)
- "Compiling..."
- "Writing articles..."
- Final count: "Compilation complete. X created. Y updated. Z connections found."

- [ ] **Step 6: Verify source count accuracy**

Check that the sidebar source count matches the actual number of compiled sources (not pending/failed ones). Feed a bad URL that fails — count should not increment.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/app/\[engram\]/feed/page.tsx
git commit -m "feat: feed dedup, realtime progress, accurate source count"
```

---

### Task 4: End-to-End Verification

- [ ] **Step 1: Test PDF upload end-to-end**

Upload a real multi-page PDF. Verify: parsing extracts text, compilation creates articles, progress shows stages, source count is correct.

- [ ] **Step 2: Test DOCX upload end-to-end**

Upload a real DOCX. Same verification.

- [ ] **Step 3: Test URL feed end-to-end**

Feed a content-rich URL (e.g., a Wikipedia article). Verify: Readability extracts content, compilation creates articles, progress shows "Fetching content..." → "Compiling..." → "Writing articles..." → final count.

- [ ] **Step 4: Test failure cases**

- Feed a URL that can't be fetched (bad domain) — should show error
- Upload an empty/corrupt PDF — should show "Could not parse file."
- Feed a URL that returns minimal content (< 50 chars) — should show "Could not extract content from this URL"
