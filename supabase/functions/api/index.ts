import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function err(message: string, status = 400) {
  return json({ error: message }, status)
}

// ── Auth: resolve Bearer token → user_id ────────────────────────────

async function resolveToken(
  req: Request,
  supabase: ReturnType<typeof createClient>,
): Promise<{ userId: string } | Response> {
  const auth = req.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) {
    return err("Missing Authorization: Bearer <token>", 401)
  }
  const token = auth.slice(7).trim()
  if (!token) return err("Empty token", 401)

  const { data, error } = await supabase
    .from("api_tokens")
    .select("user_id")
    .eq("token", token)
    .single()

  if (error || !data) return err("Invalid token", 401)

  // Update last_used_at (fire and forget)
  supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token", token)
    .then(() => {})

  return { userId: data.user_id }
}

// ── Route parsing ───────────────────────────────────────────────────

function parsePath(url: URL): { segments: string[]; query: URLSearchParams } {
  // Path comes after /functions/v1/api/
  const full = url.pathname
  const apiIdx = full.indexOf("/api")
  const after = apiIdx >= 0 ? full.slice(apiIdx + 4) : full
  const segments = after.split("/").filter(Boolean)
  return { segments, query: url.searchParams }
}

// ── Handlers ────────────────────────────────────────────────────────

async function listEngrams(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("engrams")
    .select("id, slug, name, description, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })

  if (error) return err(error.message, 500)
  return json({ engrams: data })
}

async function createEngram(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const name = body.name as string
  if (!name?.trim()) return err("name is required")

  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  const { data, error } = await supabase
    .from("engrams")
    .insert({
      owner_id: userId,
      name: name.trim(),
      slug,
      description: (body.description as string) ?? null,
    })
    .select("id, slug, name")
    .single()

  if (error) return err(error.message, 500)
  return json({ engram: data }, 201)
}

async function feedSource(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  body: Record<string, unknown>,
) {
  const sourceType = (body.type as string) ?? "url"
  const content = body.content as string ?? body.url as string
  if (!content?.trim()) return err("content or url is required")

  const title = (body.title as string) ?? content.slice(0, 80)

  const insertData: Record<string, unknown> = {
    engram_id: engramId,
    source_type: sourceType,
    title,
    status: "pending",
  }

  if (sourceType === "url") {
    insertData.source_url = content.trim()
    insertData.content_md = null
  } else {
    insertData.source_url = null
    insertData.content_md = content.trim()
  }

  const { data: source, error: insertErr } = await supabase
    .from("sources")
    .insert(insertData)
    .select("id")
    .single()

  if (insertErr) return err(insertErr.message, 500)

  // Fire compile (don't await — it takes 30-60s)
  supabase.functions
    .invoke("compile-source", { body: { source_id: source.id } })
    .then(() => {})

  return json({
    source_id: source.id,
    status: "compiling",
    message: "Source queued for compilation. Articles will appear shortly.",
  }, 202)
}

async function askEngram(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  body: Record<string, unknown>,
) {
  const question = body.question as string
  if (!question?.trim()) return err("question is required")

  const { data, error: fnErr } = await supabase.functions.invoke(
    "ask-engram",
    { body: { engram_id: engramId, question: question.trim() } },
  )

  if (fnErr) return err(fnErr.message ?? "ask-engram failed", 500)
  return json(data)
}

async function listArticles(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  query: URLSearchParams,
) {
  const limit = Math.min(parseInt(query.get("limit") ?? "50"), 200)
  const offset = parseInt(query.get("offset") ?? "0")

  const { data, error, count } = await supabase
    .from("articles")
    .select("slug, title, summary, confidence, article_type, tags, created_at", { count: "exact" })
    .eq("engram_id", engramId)
    .neq("article_type", "summary")
    .order("confidence", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return err(error.message, 500)
  return json({ articles: data, total: count })
}

async function readArticle(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  slug: string,
) {
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, summary, content_md, confidence, article_type, tags, source_ids, related_slugs, created_at, updated_at")
    .eq("engram_id", engramId)
    .eq("slug", slug)
    .single()

  if (error || !data) return err("Article not found", 404)
  return json({ article: data })
}

async function searchArticles(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  query: URLSearchParams,
) {
  const q = query.get("q")?.trim()
  if (!q) return err("q parameter is required")

  // Simple text search via ilike on title + content
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, summary, confidence, article_type, tags")
    .eq("engram_id", engramId)
    .neq("article_type", "summary")
    .or(`title.ilike.%${q}%,content_md.ilike.%${q}%`)
    .order("confidence", { ascending: false })
    .limit(20)

  if (error) return err(error.message, 500)
  return json({ results: data, query: q })
}

// ── Ownership check ─────────────────────────────────────────────────

async function verifyEngramAccess(
  supabase: ReturnType<typeof createClient>,
  engramId: string,
  userId: string,
): Promise<true | Response> {
  const { data } = await supabase
    .from("engrams")
    .select("id")
    .eq("id", engramId)
    .eq("owner_id", userId)
    .single()

  if (!data) return err("Engram not found or not owned by you", 404)
  return true
}

// ── Main router ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // Auth
  const authResult = await resolveToken(req, supabase)
  if (authResult instanceof Response) return authResult
  const { userId } = authResult

  const url = new URL(req.url)
  const { segments, query } = parsePath(url)
  const method = req.method

  try {
    // GET /engrams
    if (segments[0] === "engrams" && !segments[1] && method === "GET") {
      return listEngrams(supabase, userId)
    }

    // POST /engrams
    if (segments[0] === "engrams" && !segments[1] && method === "POST") {
      const body = await req.json()
      return createEngram(supabase, userId, body)
    }

    // Routes that need an engram ID
    if (segments[0] === "engrams" && segments[1]) {
      const engramId = segments[1]
      const access = await verifyEngramAccess(supabase, engramId, userId)
      if (access instanceof Response) return access

      // POST /engrams/:id/feed
      if (segments[2] === "feed" && method === "POST") {
        const body = await req.json()
        return feedSource(supabase, engramId, body)
      }

      // POST /engrams/:id/ask
      if (segments[2] === "ask" && method === "POST") {
        const body = await req.json()
        return askEngram(supabase, engramId, body)
      }

      // GET /engrams/:id/articles
      if (segments[2] === "articles" && !segments[3] && method === "GET") {
        return listArticles(supabase, engramId, query)
      }

      // GET /engrams/:id/articles/:slug
      if (segments[2] === "articles" && segments[3] && method === "GET") {
        return readArticle(supabase, engramId, segments[3])
      }

      // GET /engrams/:id/search?q=
      if (segments[2] === "search" && method === "GET") {
        return searchArticles(supabase, engramId, query)
      }
    }

    return err("Not found", 404)
  } catch (e) {
    return err(`Internal error: ${String(e).slice(0, 200)}`, 500)
  }
})
