import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { Readability } from "npm:@mozilla/readability"
import { parseHTML } from "npm:linkedom"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// =============================================================================
// URL RETRIEVAL PIPELINE
// =============================================================================
//
// Tiered retrieval for turning a source URL into LLM-ready markdown:
//
//   Tier 1  per-domain specializers  (github, wikipedia, arxiv, reddit, hn, youtube)
//   Tier 2  Jina Reader              (https://r.jina.ai/<url>  — handles SPAs + PDFs)
//   Tier 3  Local Readability + NodeHtmlMarkdown  (hardened fallback)
//
// Every tier has a timeout. Every HTTP read is size-capped. Non-text content
// types are gated out before we try to parse them as HTML.
//
// Output is markdown — NOT plain text — so the compiler LLM keeps structural
// cues (headings, lists, code blocks, links, alt text). This is the single
// biggest quality lever.

interface RetrievalResult {
  markdown: string
  title: string | null
  final_url: string
  content_type: string | null
  source_kind:
    | "github"
    | "wikipedia"
    | "arxiv"
    | "doi"
    | "reddit"
    | "hackernews"
    | "youtube"
    | "jina"
    | "readability"
  byte_length: number
}

const UA = "Mozilla/5.0 (compatible; Engrams/1.0; +https://engrams.app)"

function byteLen(s: string): number {
  return new TextEncoder().encode(s).byteLength
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 10_000,
): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
}

// Read a response body as text, aborting after `maxBytes` to protect the
// edge function from hostile or bloated pages.
async function readLimitedText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return await res.text()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    received += value.byteLength
    if (received >= maxBytes) {
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      break
    }
  }
  const buf = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf)
}

async function sha256(str: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// -----------------------------------------------------------------------------
// Classification
// -----------------------------------------------------------------------------

type Classification =
  | { kind: "github" }
  | { kind: "wikipedia"; lang: string; title: string }
  | { kind: "arxiv"; id: string; isPdf: boolean }
  | { kind: "doi"; doi: string }
  | { kind: "reddit" }
  | { kind: "hackernews"; id: string }
  | { kind: "youtube" }
  | { kind: "generic" }

// Extract a DOI from any URL — doi.org direct, journal landing pages, query
// strings. Matches the standard "10.<registrant>/<suffix>" pattern, plus
// publisher-specific URL schemes where the DOI has to be reconstructed from
// a slug (Nature is the main offender: nature.com/articles/<id> → 10.1038/<id>).
function extractDoi(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "")

  // Nature portfolio — any nature.com/articles/<id> URL maps to 10.1038/<id>.
  // Covers nature14236, s41586-xxx-xxx-x, s41467-xxx, etc.
  if (host === "nature.com" || host.endsWith(".nature.com")) {
    const m = url.pathname.match(/^\/articles\/([a-z0-9._-]+?)(?:\/|$)/i)
    if (m) return `10.1038/${m[1]}`
  }

  // Generic path/query scan for any "10.xxxx/yyyy" pattern. Catches doi.org,
  // science.org, wiley, plos (query-string DOIs), springer, tandfonline, etc.
  const haystack = decodeURIComponent(url.pathname + url.search)
  const m = haystack.match(/10\.\d{4,9}\/[^\s?#&"'<>]+/)
  if (!m) return null
  return m[0].replace(/[.,;)\]}]+$/, "")
}

function classifyUrl(urlStr: string): Classification {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    return { kind: "generic" }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "")

  if (host === "github.com") return { kind: "github" }

  if (host.endsWith(".wikipedia.org")) {
    const lang = host.split(".")[0]
    const m = url.pathname.match(/^\/wiki\/(.+)$/)
    if (m) return { kind: "wikipedia", lang, title: decodeURIComponent(m[1]) }
  }

  if (host === "arxiv.org") {
    const m = url.pathname.match(/\/(?:abs|pdf)\/([^/]+?)(?:\.pdf)?$/)
    if (m) return { kind: "arxiv", id: m[1], isPdf: url.pathname.includes("/pdf/") }
  }

  if (host === "reddit.com" || host === "old.reddit.com") return { kind: "reddit" }

  if (host === "news.ycombinator.com") {
    const id = url.searchParams.get("id")
    if (id) return { kind: "hackernews", id }
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    return { kind: "youtube" }
  }

  // DOI-bearing URLs — check last, after all the more specific handlers.
  // Catches doi.org, science.org, nature.com, wiley, plos, springer,
  // tandfonline, sage, and any other journal that embeds a DOI in the URL.
  const doi = extractDoi(url)
  if (doi) return { kind: "doi", doi }

  return { kind: "generic" }
}

// -----------------------------------------------------------------------------
// Tier 1: Per-domain handlers
// -----------------------------------------------------------------------------

async function retrieveGithub(urlStr: string): Promise<RetrievalResult | null> {
  const url = new URL(urlStr)
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length < 2) return null
  const [owner, repo, maybeKind, ...rest] = parts
  const gh = { Accept: "application/vnd.github+json" }

  // Repo root → README
  if (!maybeKind) {
    const readmeRes = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: { Accept: "application/vnd.github.raw" } },
      8000,
    ).catch(() => null)
    if (!readmeRes?.ok) return null
    const readme = await readmeRes.text()

    const metaRes = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: gh },
      5000,
    ).catch(() => null)
    const meta = metaRes?.ok ? await metaRes.json().catch(() => null) : null

    const title = meta?.full_name ?? `${owner}/${repo}`
    const description = meta?.description ? `\n\n> ${meta.description}\n` : "\n"
    const markdown = `# ${title}${description}\n${readme}`
    return {
      markdown,
      title,
      final_url: urlStr,
      content_type: "text/markdown",
      source_kind: "github",
      byte_length: byteLen(markdown),
    }
  }

  // Issue or PR
  if ((maybeKind === "issues" || maybeKind === "pull") && rest[0]) {
    const num = rest[0]
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/issues/${num}`,
      { headers: gh },
      8000,
    ).catch(() => null)
    if (!res?.ok) return null
    const data = await res.json()
    const body = data.body ?? ""
    const title = `${owner}/${repo}#${num}: ${data.title ?? ""}`.trim()
    const markdown =
      `# ${data.title ?? `Issue #${num}`}\n\n` +
      `**Repository:** ${owner}/${repo}\n` +
      `**Author:** ${data.user?.login ?? "unknown"}\n` +
      `**State:** ${data.state ?? "unknown"}\n\n${body}`
    return {
      markdown,
      title,
      final_url: urlStr,
      content_type: "text/markdown",
      source_kind: "github",
      byte_length: byteLen(markdown),
    }
  }

  // File: /blob/<branch>/<path>
  if (maybeKind === "blob" && rest.length >= 2) {
    const [branch, ...pathParts] = rest
    const path = pathParts.join("/")
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
    const res = await fetchWithTimeout(raw, { headers: { "User-Agent": UA } }, 8000).catch(
      () => null,
    )
    if (!res?.ok) return null
    const body = await readLimitedText(res, 500_000)
    const title = `${owner}/${repo}/${path}`
    const isMarkdown = /\.(md|markdown)$/i.test(path)
    const markdown = isMarkdown ? body : `# ${title}\n\n\`\`\`\n${body}\n\`\`\`\n`
    return {
      markdown,
      title,
      final_url: urlStr,
      content_type: "text/plain",
      source_kind: "github",
      byte_length: byteLen(markdown),
    }
  }

  return null
}

async function retrieveWikipedia(
  urlStr: string,
  cls: Extract<Classification, { kind: "wikipedia" }>,
): Promise<RetrievalResult | null> {
  const { lang, title } = cls
  const enc = encodeURIComponent(title)

  const summaryRes = await fetchWithTimeout(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`,
    { headers: { "User-Agent": UA, Accept: "application/json" } },
    8000,
  ).catch(() => null)
  if (!summaryRes?.ok) return null
  const summary = await summaryRes.json()

  // Full plaintext extract via the classic MediaWiki API
  const extractRes = await fetchWithTimeout(
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${enc}&format=json&origin=*`,
    { headers: { "User-Agent": UA } },
    10_000,
  ).catch(() => null)

  let fullText = summary.extract ?? ""
  if (extractRes?.ok) {
    try {
      const data = await extractRes.json()
      const pages = data?.query?.pages ?? {}
      const first: any = Object.values(pages)[0]
      if (first?.extract) fullText = first.extract
    } catch {
      /* fall through to summary.extract */
    }
  }

  // Wikipedia's summary.titles.display can contain HTML (<span>, <i>, etc.) —
  // strip tags so it works as a plain title in the UI and DB.
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim()
  const displayTitle = stripTags(summary.titles?.display ?? summary.title ?? title)
  const description = summary.description ? `\n*${summary.description}*\n` : ""
  const markdown = `# ${displayTitle}\n${description}\n${fullText}`

  return {
    markdown,
    title: displayTitle,
    final_url: summary.content_urls?.desktop?.page ?? urlStr,
    content_type: "text/markdown",
    source_kind: "wikipedia",
    byte_length: byteLen(markdown),
  }
}

async function retrieveArxiv(
  urlStr: string,
  cls: Extract<Classification, { kind: "arxiv" }>,
): Promise<RetrievalResult | null> {
  if (cls.isPdf) return null // let Jina Reader handle PDFs
  const { id } = cls
  const res = await fetchWithTimeout(
    `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
    { headers: { "User-Agent": UA } },
    10_000,
  ).catch(() => null)
  if (!res?.ok) return null
  const xml = await res.text()

  const titleMatch = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/)
  const summaryMatch = xml.match(/<entry>[\s\S]*?<summary>([\s\S]*?)<\/summary>/)
  const publishedMatch = xml.match(/<entry>[\s\S]*?<published>([\s\S]*?)<\/published>/)
  const authorMatches = [
    ...xml.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g),
  ]

  const title = (titleMatch?.[1] ?? id).replace(/\s+/g, " ").trim()
  const abstract = (summaryMatch?.[1] ?? "").replace(/\s+/g, " ").trim()
  const published = (publishedMatch?.[1] ?? "").trim()
  const authors = authorMatches.map((m) => m[1].trim()).join(", ")

  if (!abstract) return null

  const markdown =
    `# ${title}\n\n` +
    `**arXiv:** [${id}](https://arxiv.org/abs/${id})\n` +
    `**Authors:** ${authors}\n` +
    `**Published:** ${published}\n\n` +
    `## Abstract\n\n${abstract}\n`

  return {
    markdown,
    title: `arXiv:${id} — ${title}`,
    final_url: urlStr,
    content_type: "text/markdown",
    source_kind: "arxiv",
    byte_length: byteLen(markdown),
  }
}

// DOI handler — fetches Semantic Scholar and CrossRef in parallel and
// merges them into one markdown. The two sources are complementary:
//
//   Semantic Scholar: title, TL;DR (AI-generated summary), authors, venue,
//                     year, citation count, fields of study, open-access PDF
//   CrossRef:         title, authors, journal, publisher, full abstract
//                     (often elided from S2 for copyright reasons — Science,
//                     Nature, etc. only register the abstract with CrossRef)
//
// Using both gives us a richer record than either alone and bypasses the
// paywall/Cloudflare gate that blocks scraping for most academic journals.
async function retrieveDoi(
  urlStr: string,
  cls: Extract<Classification, { kind: "doi" }>,
): Promise<RetrievalResult | null> {
  const { doi } = cls

  const [ss, cr] = await Promise.all([
    fetchWithTimeout(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract,tldr,authors,year,venue,citationCount,fieldsOfStudy,openAccessPdf`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
      8000,
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetchWithTimeout(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
      8000,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body?.message ?? null)
      .catch(() => null),
  ])

  // Coalesce title from either source
  const title: string =
    (ss?.title as string) ?? (cr?.title?.[0] as string) ?? ""
  if (!title) return null

  // Authors: prefer CrossRef (given/family split) but fall back to S2
  let authors = ""
  if (cr?.author?.length) {
    authors = cr.author
      .map((a: any) => `${a?.given ?? ""} ${a?.family ?? ""}`.trim())
      .filter(Boolean)
      .join(", ")
  } else if (ss?.authors?.length) {
    authors = ss.authors
      .map((a: any) => a?.name)
      .filter(Boolean)
      .join(", ")
  }

  // Journal / venue
  const venue: string =
    (cr?.["container-title"]?.[0] as string) ??
    (ss?.venue as string) ??
    ""
  const year: string | number =
    cr?.["published-print"]?.["date-parts"]?.[0]?.[0] ??
    cr?.published?.["date-parts"]?.[0]?.[0] ??
    (ss?.year as number | string) ??
    ""
  const publisher: string = (cr?.publisher as string) ?? ""

  // Abstract: CrossRef wraps in JATS tags like <jats:p>...</jats:p>
  let abstract = ""
  if (cr?.abstract) {
    abstract = String(cr.abstract).replace(/<[^>]+>/g, "").trim()
  }
  if (!abstract && ss?.abstract) {
    abstract = String(ss.abstract).trim()
  }

  // Semantic Scholar extras
  const tldr: string = ss?.tldr?.text ?? ""
  const fields: string = (ss?.fieldsOfStudy ?? []).join(", ")
  const citations: number | null =
    typeof ss?.citationCount === "number" ? ss.citationCount : null
  const openPdf: string = ss?.openAccessPdf?.url ?? ""

  // Refuse to return if we have nothing beyond a title
  if (!abstract && !tldr && !venue && !authors) return null

  const lines: string[] = [`# ${title}`, ""]
  lines.push(`**DOI:** [${doi}](https://doi.org/${doi})  `)
  if (authors) lines.push(`**Authors:** ${authors}  `)
  if (venue) lines.push(`**Journal:** ${venue}${year ? ` (${year})` : ""}  `)
  if (publisher) lines.push(`**Publisher:** ${publisher}  `)
  if (fields) lines.push(`**Fields:** ${fields}  `)
  if (citations != null) lines.push(`**Citations:** ${citations}`)
  if (tldr) {
    lines.push("", "## TL;DR", "", tldr)
  }
  if (abstract) {
    lines.push("", "## Abstract", "", abstract)
  }
  if (openPdf) {
    lines.push("", `[Open Access PDF](${openPdf})`)
  }
  const markdown = lines.join("\n")

  return {
    markdown,
    title,
    final_url: urlStr,
    content_type: "text/markdown",
    source_kind: "doi",
    byte_length: byteLen(markdown),
  }
}

function decodeHnHtml(s: string): string {
  return s
    .replace(/<p>/g, "\n\n")
    .replace(/<\/p>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "[$2]($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
}

async function retrieveReddit(urlStr: string): Promise<RetrievalResult | null> {
  const url = new URL(urlStr)
  url.hostname = "www.reddit.com"
  // Ensure exactly one trailing slash before .json
  const path = url.pathname.replace(/\/?$/, "/")
  const jsonUrl = `https://www.reddit.com${path}.json${url.search}`

  const res = await fetchWithTimeout(
    jsonUrl,
    { headers: { "User-Agent": UA, Accept: "application/json" } },
    10_000,
  ).catch(() => null)
  if (!res?.ok) return null

  const data = await res.json().catch(() => null)
  if (!Array.isArray(data) || data.length < 1) return null
  const post = data[0]?.data?.children?.[0]?.data
  if (!post) return null

  const comments = (data[1]?.data?.children ?? [])
    .slice(0, 10)
    .map((c: any) => c?.data)
    .filter((c: any) => c?.body && c.author !== "AutoModerator")
    .map(
      (c: any) =>
        `**u/${c.author}** (${c.score}↑)\n\n${String(c.body).trim()}`,
    )
    .join("\n\n---\n\n")

  const body = post.selftext ? String(post.selftext).trim() : ""
  const linkedUrl = post.url && post.url !== urlStr ? `\n**Linked:** ${post.url}\n` : ""

  const markdown =
    `# ${post.title}\n\n` +
    `**Posted by** u/${post.author} in r/${post.subreddit}${linkedUrl}\n` +
    (body ? `${body}\n\n` : "") +
    (comments ? `## Top comments\n\n${comments}\n` : "")

  return {
    markdown,
    title: post.title,
    final_url: urlStr,
    content_type: "text/markdown",
    source_kind: "reddit",
    byte_length: byteLen(markdown),
  }
}

async function retrieveHackerNews(
  cls: Extract<Classification, { kind: "hackernews" }>,
): Promise<RetrievalResult | null> {
  const { id } = cls
  const itemRes = await fetchWithTimeout(
    `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
    {},
    8000,
  ).catch(() => null)
  if (!itemRes?.ok) return null
  const item = await itemRes.json().catch(() => null)
  if (!item) return null

  const kidIds: number[] = (item.kids ?? []).slice(0, 8)
  const commentTexts = await Promise.all(
    kidIds.map(async (kid) => {
      try {
        const r = await fetchWithTimeout(
          `https://hacker-news.firebaseio.com/v0/item/${kid}.json`,
          {},
          4000,
        )
        if (!r.ok) return null
        const c = await r.json()
        if (!c?.text) return null
        return `**${c.by}**\n\n${decodeHnHtml(c.text)}`
      } catch {
        return null
      }
    }),
  )
  const comments = commentTexts.filter(Boolean).join("\n\n---\n\n")

  const title = item.title ?? `Hacker News item ${id}`
  const linkLine = item.url ? `**Link:** ${item.url}\n` : ""
  const bodyLine = item.text ? `\n${decodeHnHtml(item.text)}\n` : ""

  const markdown =
    `# ${title}\n\n` +
    `**Author:** ${item.by ?? "unknown"}  \n` +
    `**Score:** ${item.score ?? "?"}\n` +
    linkLine +
    bodyLine +
    (comments ? `\n## Top comments\n\n${comments}\n` : "")

  return {
    markdown,
    title,
    final_url: `https://news.ycombinator.com/item?id=${id}`,
    content_type: "text/markdown",
    source_kind: "hackernews",
    byte_length: byteLen(markdown),
  }
}

async function retrieveYoutube(urlStr: string): Promise<RetrievalResult | null> {
  // Grab title + channel from oEmbed, then delegate body to Jina Reader,
  // which extracts the video description and caption text when available.
  const oembedRes = await fetchWithTimeout(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(urlStr)}`,
    { headers: { "User-Agent": UA } },
    5000,
  ).catch(() => null)

  let title: string | null = null
  let author: string | null = null
  if (oembedRes?.ok) {
    try {
      const data = await oembedRes.json()
      title = data?.title ?? null
      author = data?.author_name ?? null
    } catch {
      /* ignore */
    }
  }

  const viaJina = await retrieveViaJina(urlStr).catch(() => null)

  if (!viaJina) {
    if (!title) return null
    const markdown = `# ${title}\n\n**Channel:** ${author ?? "unknown"}\n\n*Video metadata only — transcript unavailable.*\n`
    return {
      markdown,
      title,
      final_url: urlStr,
      content_type: "text/markdown",
      source_kind: "youtube",
      byte_length: byteLen(markdown),
    }
  }

  const header = title ? `# ${title}\n\n**Channel:** ${author ?? "unknown"}\n\n` : ""
  const markdown = header + viaJina.markdown
  return {
    markdown,
    title: title ?? viaJina.title,
    final_url: viaJina.final_url,
    content_type: viaJina.content_type,
    source_kind: "youtube",
    byte_length: byteLen(markdown),
  }
}

// -----------------------------------------------------------------------------
// Tier 2: Jina Reader
// -----------------------------------------------------------------------------

async function retrieveViaJina(urlStr: string): Promise<RetrievalResult | null> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
  }
  const jinaKey = Deno.env.get("JINA_API_KEY")
  if (jinaKey) headers["Authorization"] = `Bearer ${jinaKey}`

  const res = await fetchWithTimeout(
    `https://r.jina.ai/${urlStr}`,
    { headers },
    12_000,
  ).catch(() => null)
  if (!res?.ok) return null

  const markdown = (await res.text()).trim()
  if (markdown.length < 50) return null

  // Detect bot-protection / paywall / access-error pages that Jina cheerfully
  // echoes through as "content". Treating these as real content gives the
  // compiler garbage and surfaces confusing "0 created" toasts to the user.
  // Returning null here lets the orchestrator fail cleanly.
  if (isBotBlockedContent(markdown)) return null

  // Jina emits a "Title: ..." header at the top when there's no H1; pull that.
  let title: string | null = null
  const titleHeader = markdown.match(/^Title:\s*(.+)$/m)
  if (titleHeader) title = titleHeader[1].trim()
  else {
    const h1 = markdown.match(/^#\s+(.+)$/m)
    if (h1) title = h1[1].trim()
  }

  return {
    markdown,
    title,
    final_url: urlStr,
    content_type: res.headers.get("content-type"),
    source_kind: "jina",
    byte_length: byteLen(markdown),
  }
}

// Signatures for bot-blocked / access-denied pages that Jina (or Readability)
// might still hand back to us. We reject these so the orchestrator can fall
// through to another tier or fail cleanly.
function isBotBlockedContent(md: string): boolean {
  const head = md.slice(0, 2000)
  return (
    /Warning:\s*Target URL returned error (4\d\d|5\d\d)/i.test(head) ||
    /^#\s+Just a moment\.\.\./im.test(head) ||
    /Performing security verification/i.test(head) ||
    /Checking your browser before accessing/i.test(head) ||
    /Cloudflare Ray ID/i.test(head) ||
    /Attention Required!\s*\|\s*Cloudflare/i.test(head) ||
    /Access to this page has been denied/i.test(head) ||
    /Please enable (JS|JavaScript) and cookies to continue/i.test(head)
  )
}

// -----------------------------------------------------------------------------
// Tier 3: Local Readability + NodeHtmlMarkdown fallback
// -----------------------------------------------------------------------------

// Minimal HTML → markdown converter. Not as thorough as a real library, but
// good enough to preserve headings, paragraphs, links, code, and lists in the
// fallback path. The primary paths (per-domain handlers + Jina) already emit
// clean markdown, so this only runs when both of those fail.
function simpleHtmlToMarkdown(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n")
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n\n```\n$1\n```\n\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<ul[^>]*>/gi, "\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<ol[^>]*>/gi, "\n")
    .replace(/<\/ol>/gi, "\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n\n> $1\n\n")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function retrieveViaReadability(urlStr: string): Promise<RetrievalResult | null> {
  // HEAD probe — skip non-text content types so we don't parse binary as HTML.
  let contentType: string | null = null
  try {
    const headRes = await fetchWithTimeout(urlStr, { method: "HEAD", headers: { "User-Agent": UA } }, 5000)
    contentType = headRes.headers.get("content-type")
  } catch {
    // Some servers 405/timeout on HEAD; continue to GET and let content-type
    // come from the GET response instead.
  }
  if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
    return null
  }

  const res = await fetchWithTimeout(
    urlStr,
    { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } },
    10_000,
  ).catch(() => null)
  if (!res?.ok) return null

  const html = await readLimitedText(res, 2_000_000) // 2 MB cap
  const finalUrl = res.url ?? urlStr
  if (!contentType) contentType = res.headers.get("content-type")

  let title: string | null = null
  let markdown = ""

  try {
    const { document } = parseHTML(html)
    const reader = new Readability(document)
    const article = reader.parse()
    if (article?.content) {
      markdown = simpleHtmlToMarkdown(article.content)
      title = article.title ?? null
    }
  } catch {
    // parseHTML or Readability can throw on malformed input — fall through
  }

  if (!markdown || markdown.length < 50) {
    // Last-ditch strip fallback (kept from the old implementation).
    markdown = html
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

  if (markdown.length < 50) return null

  if (!title) {
    const tm = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (tm) title = tm[1].trim()
  }

  return {
    markdown,
    title,
    final_url: finalUrl,
    content_type: contentType,
    source_kind: "readability",
    byte_length: byteLen(markdown),
  }
}

// -----------------------------------------------------------------------------
// Orchestrator
// -----------------------------------------------------------------------------

async function retrieveUrl(urlStr: string): Promise<RetrievalResult | null> {
  const cls = classifyUrl(urlStr)

  // Tier 1: specialized handlers
  try {
    if (cls.kind === "github") {
      const r = await retrieveGithub(urlStr)
      if (r) return r
    } else if (cls.kind === "wikipedia") {
      const r = await retrieveWikipedia(urlStr, cls)
      if (r) return r
    } else if (cls.kind === "arxiv") {
      const r = await retrieveArxiv(urlStr, cls)
      if (r) return r
    } else if (cls.kind === "doi") {
      const r = await retrieveDoi(urlStr, cls)
      if (r) return r
    } else if (cls.kind === "reddit") {
      const r = await retrieveReddit(urlStr)
      if (r) return r
    } else if (cls.kind === "hackernews") {
      const r = await retrieveHackerNews(cls)
      if (r) return r
    } else if (cls.kind === "youtube") {
      const r = await retrieveYoutube(urlStr)
      if (r) return r
    }
  } catch {
    // Any unhandled exception inside a specialized handler → fall through
  }

  // Tier 2: Jina Reader
  try {
    const r = await retrieveViaJina(urlStr)
    if (r) return r
  } catch {
    /* fall through */
  }

  // Tier 3: Local Readability + NodeHtmlMarkdown
  try {
    const r = await retrieveViaReadability(urlStr)
    if (r) return r
  } catch {
    /* give up */
  }

  return null
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

// ═══════════════════════════════════════════════════════════════
// Prompt templates.
//
// Each compile-source prompt is composed at runtime as:
//
//   [fixed persona header]
//   [guidance: either user-overridden template body or hardcoded default]
//   [fixed output format spec]
//   [prevention rules block]
//
// Only the guidance block is user-editable (via Settings > Prompts).
// The persona and output format stay rigid so the JSON response
// contract is always valid and parsing never breaks.
// ═══════════════════════════════════════════════════════════════

const TEMPLATE_NAMES = ["summarize_source", "write_concept"] as const
type TemplateName = typeof TEMPLATE_NAMES[number]

type TemplateMap = Partial<Record<TemplateName, string>>

const DEFAULT_SUMMARIZE_GUIDANCE = `Your job in this pass is twofold:
1. Produce a dense, encyclopedic summary of the given source — capturing its central claims, definitions, and any unique facts, in markdown. Prefer depth over breadth. 400–800 words is a good target for most sources.
2. Identify the distinct concepts in the source that deserve their own standalone wiki articles. A concept is a named idea, technique, entity, or claim that could be explained without the source in front of you. Typically 1–6 per source.

Rules for the summary:
- Third-person, encyclopedic voice. No first person. No hedging. No filler like "it is important to note".
- Preserve concrete facts, numbers, names, and terminology from the source.
- Do not fabricate.

Rules for the concepts:
- Each concept is a short name (2–4 words typically) plus a one-sentence working definition drawn from the source.
- Concepts should be specific enough to be useful ("Reciprocal Rank Fusion", not "ranking").
- Do not invent concepts that the source does not substantively cover.

Also identify unresolved questions — things this source raises or leaves open. Genuine research questions, not trivial gaps.`

const DEFAULT_WRITE_GUIDANCE = `You will write or rewrite a single wiki article. The input gives you:
- The topic name and a working definition.
- The new summary of a source that mentions this topic (Pass A output).
- The existing article for this topic, if one already exists.
- The wiki index — a flat list of all other article slugs so you can link to them.

Your job:
- Produce a clear, encyclopedic article that explains the topic in its own right, drawing on the new summary and the existing article.
- When an existing article is provided, treat it as the working draft and update it with any new information from the summary. Preserve its voice and any still-accurate claims.
- Use [[slug]] syntax to link to related articles from the wiki index. Only reference slugs that actually appear in the index or in this concept's new slug.
- For every [[slug]] you cite, add an entry to \`link_weights\` with a number from 0.1 to 1.0 indicating how essential that connection is. 1.0 = the article cannot be understood without the linked concept (parent topic, hard prerequisite, central counterpoint). 0.6 = supporting context worth knowing. 0.2 = a passing reference. The driver of the layout is this number, so be honest — don't grade everything 1.0.
- Third person, encyclopedic. No first person. No hedging. No filler.
- Assign confidence 0.0–1.0 based on how well the sources support the claims.
- Tags are lowercase, 1–2 words each, 2–5 total.

Pick the article_type that best matches what the article actually is. Use the most specific type that applies — do not default to concept unless nothing else fits.
- technique — use when the article is primarily about how to do something, a method, procedure, process, or workflow. Titles like "Dry Process", "V60 Brew", "Git Rebase".
- claim — use when the article's main purpose is to defend or challenge a specific falsifiable assertion.
- artifact — use when the article is primarily about a specific file, document, paper, dataset, or external reference the wiki cites directly.
- synthesis — use when the article explicitly ties multiple other concepts together and would not stand on its own without them.
- concept — use when the article is a named idea, definition, or theory and none of the above apply. This is the fallback, not the default.

Pick carefully. A good signal: if the title starts with a gerund ("Aging", "Roasting") or describes a step or process, it's almost always a technique. If it names a theory, object, or idea, it's a concept.`

async function loadActiveTemplates(
  supabase: ReturnType<typeof import("jsr:@supabase/supabase-js@2").createClient>,
  engramId: string,
): Promise<TemplateMap> {
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("name, body")
    .eq("engram_id", engramId)
    .eq("status", "active")

  if (error) {
    console.error("[compile-source] loadActiveTemplates error", error)
    return {}
  }

  const map: TemplateMap = {}
  for (const row of (data ?? []) as { name: string; body: string }[]) {
    if (TEMPLATE_NAMES.includes(row.name as TemplateName)) {
      map[row.name as TemplateName] = row.body
    }
  }
  return map
}

function guidanceFor(
  templates: TemplateMap,
  name: TemplateName,
): { body: string; source: "user" | "default" } {
  const override = templates[name]
  if (override && override.trim()) {
    return { body: override.trim(), source: "user" }
  }
  const defaults: Record<TemplateName, string> = {
    summarize_source: DEFAULT_SUMMARIZE_GUIDANCE,
    write_concept: DEFAULT_WRITE_GUIDANCE,
  }
  return { body: defaults[name], source: "default" }
}

// Note: the Settings > Prompts UI mirrors DEFAULT_SUMMARIZE_GUIDANCE and
// DEFAULT_WRITE_GUIDANCE verbatim in apps/web/lib/prompt-defaults.ts.
// Keep both in sync when tuning the defaults.

// ═══════════════════════════════════════════════════════════════
// Prevention rule loading + prompt formatting.
//
// Rules are captured from user corrections (and, later, lint findings)
// and stored in the prevention_rules table in WHEN/CHECK/BECAUSE form.
// At compile time we load the top-weighted active rules for the engram
// and inject them into the Pass A and Pass B system prompts so the
// compiler doesn't repeat past mistakes.
//
// Pass A sees ALL active rules (capped at 10) because the source is
// ungeneralized content and we don't know its tags yet. Pass B sees
// rules whose tags overlap with the concept being written (capped at
// 15) — tag match is a cheap relevance signal that scales well even
// when an engram has hundreds of rules.
// ═══════════════════════════════════════════════════════════════

interface PreventionRule {
  id: string
  when_condition: string
  check_condition: string
  because: string
  tags: string[]
  weight: number
}

async function loadActiveRules(
  supabase: ReturnType<typeof import("jsr:@supabase/supabase-js@2").createClient>,
  engramId: string,
): Promise<PreventionRule[]> {
  const { data, error } = await supabase
    .from("prevention_rules")
    .select("id, when_condition, check_condition, because, tags, weight")
    .eq("engram_id", engramId)
    .eq("status", "active")
    .order("weight", { ascending: false })
    .limit(50)

  if (error) {
    console.error("[compile-source] loadActiveRules error", error)
    return []
  }
  return (data ?? []) as PreventionRule[]
}

function pickRulesByTagOverlap(
  rules: PreventionRule[],
  targetTags: string[],
  cap: number,
): PreventionRule[] {
  if (rules.length === 0) return []
  if (targetTags.length === 0) {
    // No tags to match against — return top N by weight.
    return rules.slice(0, cap)
  }
  const targetSet = new Set(targetTags.map((t) => t.toLowerCase()))
  return rules
    .map((r) => {
      const overlap = r.tags.reduce(
        (n, t) => (targetSet.has(t.toLowerCase()) ? n + 1 : n),
        0,
      )
      // Rules with no tags are always-on (priority boost). Rules with
      // tag overlap get a stronger priority boost. Rules with tags but
      // no overlap fall to the bottom but aren't excluded.
      const alwaysOn = r.tags.length === 0 ? 0.5 : 0
      const score = overlap * 2 + r.weight + alwaysOn
      return { rule: r, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((entry) => entry.rule)
}

function formatRulesForPrompt(rules: PreventionRule[]): string {
  if (rules.length === 0) return ""
  const lines = rules.map((r, i) => {
    // Keep it dense — one line per rule, WHEN/CHECK only, BECAUSE on a
    // continuation line. Saves tokens vs a verbose bullet list.
    return `${i + 1}. WHEN ${r.when_condition} CHECK ${r.check_condition} — BECAUSE ${r.because}`
  })
  return `## Previously-corrected issues in this wiki (follow these rules):\n${lines.join("\n")}\n`
}

async function incrementRuleUsage(
  supabase: ReturnType<typeof import("jsr:@supabase/supabase-js@2").createClient>,
  ruleIds: string[],
): Promise<void> {
  if (ruleIds.length === 0) return
  // Fire-and-forget. Usage counters are nice-to-have analytics, not
  // load-bearing, so we don't gate the compile on a failure here.
  supabase
    .rpc("increment_rule_usage", { rule_ids: ruleIds })
    .then(({ error }) => {
      if (error) console.error("[compile-source] increment_rule_usage error", error)
    })
}

// ═══════════════════════════════════════════════════════════════
// Two-pass compilation helpers.
//
// runPassA turns raw source content into a dense summary plus a list
// of concepts worthy of their own articles. One LLM call. Its output
// is the durable intermediate artifact the whole pipeline depends on.
//
// runPassB turns a single concept + the new summary + any existing
// concept article into a rewritten concept article. One LLM call per
// concept. Sees only the summary, never the full source — so prompts
// stay small and prompt caching hits hard across the N concepts in
// a compile run.
// ═══════════════════════════════════════════════════════════════

interface PassAConceptCandidate {
  name: string
  definition?: string
}

interface PassAResult {
  summaryMd: string
  concepts: PassAConceptCandidate[]
  unresolvedQuestions: string[]
}

async function runPassA(opts: {
  openaiKey: string
  sourceTitle: string
  sourceContent: string
  preventionRules: PreventionRule[]
  guidance: string
}): Promise<PassAResult | { error: string }> {
  const rulesBlock = formatRulesForPrompt(opts.preventionRules)
  // Fixed persona + user/default guidance + fixed output contract + rules.
  // The only mutable block is `opts.guidance`. Everything else is
  // non-negotiable scaffolding that protects the JSON contract.
  const systemPrompt = `You are a source summarizer for Engrams, an LLM-compiled knowledge base.

${opts.guidance}

Return ONLY valid JSON, no markdown fences.

${rulesBlock}`

  const userPrompt =
    `## Source Title\n${opts.sourceTitle}\n\n## Source Content\n${opts.sourceContent}\n\n## Output Format\n` +
    `{\n` +
    `  "summary_md": "Full summary of the source in markdown.",\n` +
    `  "concepts": [\n` +
    `    { "name": "Concept Name", "definition": "One-sentence working definition." }\n` +
    `  ],\n` +
    `  "unresolved_questions": [\n` +
    `    "Open question the source raises."\n` +
    `  ]\n` +
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
      temperature: 0.3,
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
    const summaryMd: string = typeof parsed.summary_md === "string" ? parsed.summary_md : ""
    const rawConcepts: unknown[] = Array.isArray(parsed.concepts) ? parsed.concepts : []
    const concepts: PassAConceptCandidate[] = rawConcepts
      .map((c) => {
        if (!c || typeof c !== "object") return null
        const obj = c as Record<string, unknown>
        const name = typeof obj.name === "string" ? obj.name : null
        if (!name) return null
        const definition =
          typeof obj.definition === "string" ? obj.definition : undefined
        return { name, definition }
      })
      .filter((c): c is PassAConceptCandidate => c !== null)
    const unresolvedQuestions: string[] = Array.isArray(parsed.unresolved_questions)
      ? parsed.unresolved_questions.filter((q: unknown): q is string => typeof q === "string")
      : []

    if (!summaryMd.trim()) {
      return { error: "Pass A produced no summary_md" }
    }

    return { summaryMd, concepts, unresolvedQuestions }
  } catch (err) {
    return { error: `parse error: ${String(err).slice(0, 200)}` }
  }
}

interface PassBResult {
  title: string
  summary: string
  content_md: string
  tags: string[]
  confidence: number
  article_type: string
  // LLM-assigned strength for each [[slug]] cited in content_md.
  // 0.1 = passing mention, 1.0 = essential connection. Drives the
  // force-layout's per-edge distance/strength on the frontend so the
  // map's visual clustering reflects semantic importance, not just
  // "is there an edge at all". Falls back to 0.5 if the LLM omits.
  link_weights: Record<string, number>
}

async function runPassB(opts: {
  openaiKey: string
  conceptName: string
  conceptDefinition: string
  existingArticleMd: string | null
  newSummaryMd: string
  wikiIndex: string
  preventionRules: PreventionRule[]
  guidance: string
}): Promise<PassBResult | { error: string }> {
  const rulesBlock = formatRulesForPrompt(opts.preventionRules)
  const systemPrompt = `You are a wiki article writer for Engrams, an LLM-compiled knowledge base.

${opts.guidance}

Return ONLY valid JSON, no markdown fences.

${rulesBlock}`

  const existingBlock = opts.existingArticleMd
    ? `## Existing Article\n${opts.existingArticleMd}`
    : `## Existing Article\n(none — this is a new concept)`

  const userPrompt =
    `## Concept\n${opts.conceptName}${
      opts.conceptDefinition ? ` — ${opts.conceptDefinition}` : ""
    }\n\n` +
    `## New Source Summary\n${opts.newSummaryMd}\n\n` +
    `${existingBlock}\n\n` +
    `## Wiki Index\n${opts.wikiIndex}\n\n` +
    `## Output Format\n` +
    `{\n` +
    `  "title": "Article Title",\n` +
    `  "summary": "One-sentence summary.",\n` +
    `  "content_md": "Article body in markdown. Use [[slug]] links.",\n` +
    `  "tags": ["tag1", "tag2"],\n` +
    `  "confidence": 0.85,\n` +
    `  "article_type": "concept",\n` +
    `  "link_weights": { "linked-slug-a": 0.9, "linked-slug-b": 0.4 }\n` +
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
      temperature: 0.3,
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
    const title = typeof parsed.title === "string" ? parsed.title : opts.conceptName
    const summary =
      typeof parsed.summary === "string" ? parsed.summary : opts.conceptDefinition
    const content_md = typeof parsed.content_md === "string" ? parsed.content_md : ""
    if (!content_md.trim()) {
      return { error: "Pass B produced no content_md" }
    }
    const tags: string[] = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === "string")
      : []
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.7
    const article_type =
      typeof parsed.article_type === "string" ? parsed.article_type : "concept"
    // Validate link_weights: object whose values are finite numbers in
    // [0.1, 1.0]. Anything else gets dropped silently — the edge will
    // fall back to the default weight downstream.
    const link_weights: Record<string, number> = {}
    if (parsed.link_weights && typeof parsed.link_weights === "object") {
      for (const [slug, raw] of Object.entries(parsed.link_weights)) {
        if (typeof raw !== "number" || !Number.isFinite(raw)) continue
        link_weights[slug] = Math.max(0.1, Math.min(1.0, raw))
      }
    }
    return { title, summary, content_md, tags, confidence, article_type, link_weights }
  } catch (err) {
    return { error: `parse error: ${String(err).slice(0, 200)}` }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  let runId: string | null = null
  let agentRunId: string | null = null
  const startedAt = Date.now()
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // Helper: mark both run tables with a terminal status.
  // NOTE: do NOT use `.catch(() => {})` on supabase query builders here —
  // it breaks the await chain in Deno edge runtime, silently hanging the
  // request and causing the worker to be killed mid-write. Destructure
  // `error` from the awaited result instead.
  const finishRun = async (
    status: "completed" | "failed",
    opts: {
      summary?: string
      detail?: Record<string, unknown>
      compilation?: Record<string, unknown>
    },
  ) => {
    const finished_at = new Date().toISOString()
    const duration_ms = Date.now() - startedAt
    if (runId) {
      const { error } = await supabase.from("compilation_runs").update({
        status,
        ...(opts.compilation ?? {}),
        finished_at,
      }).eq("id", runId)
      if (error) console.error("[compile-source] compilation_runs finish update error", error)
    }
    if (agentRunId) {
      const { error } = await supabase.from("agent_runs").update({
        status,
        summary: opts.summary?.slice(0, 300) ?? null,
        detail: opts.detail ?? {},
        duration_ms,
        finished_at,
      }).eq("id", agentRunId)
      if (error) console.error("[compile-source] agent_runs finish update error", error)
    }
  }

  try {
    const { source_id } = await req.json()
    if (!source_id) {
      return new Response(JSON.stringify({ error: "source_id required" }), {
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

    // Dual-write: compilation_runs (legacy) + agent_runs (new)
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

    runId = run?.id ?? null

    const { data: agentRun } = await supabase
      .from("agent_runs")
      .insert({
        engram_id: source.engram_id,
        agent_type: "compile",
        status: "running",
        trigger_id: source_id,
        detail: { source_title: source.title ?? null, source_type: source.source_type },
      })
      .select("id")
      .single()

    agentRunId = agentRun?.id ?? null

    const updateStage = async (stage: string) => {
      if (runId) {
        await supabase.from("compilation_runs")
          .update({ log: { stage } })
          .eq("id", runId)
      }
      if (agentRunId) {
        await supabase.from("agent_runs")
          .update({ detail: { stage, source_title: source.title ?? null, source_type: source.source_type } })
          .eq("id", agentRunId)
      }
    }

    let content = source.content_md ?? ""

    // --- URL retrieval (tiered: per-domain → Jina → local fallback) ---
    // Always re-fetch URL sources so the hash gate below can detect whether
    // the upstream page actually changed. The only reason content_md might
    // already be populated is that a previous compile wrote it — we're
    // happy to overwrite with a fresh retrieval.
    if (source.source_type === "url" && source.source_url) {
      await updateStage("fetching")
      const retrieveStart = Date.now()
      const retrieved = await retrieveUrl(source.source_url)
      const retrieveMs = Date.now() - retrieveStart

      if (!retrieved) {
        await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
        await finishRun("failed", {
          summary: "Could not retrieve URL content",
          detail: {
            stage: "fetching",
            error: "All retrieval tiers failed",
            url: source.source_url,
            retrieve_ms: retrieveMs,
          },
          compilation: {
            log: { stage: "fetching", error: "All retrieval tiers failed", retrieve_ms: retrieveMs },
          },
        })
        return new Response(JSON.stringify({ error: "Could not retrieve URL content" }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      content = retrieved.markdown

      const contentHash = await sha256(content.trim())
      const newTitle =
        (!source.title || source.title === source.source_url) && retrieved.title
          ? retrieved.title
          : source.title

      // ── Hash gate ────────────────────────────────────────────────
      // If the retrieved content hashes identically to what we last
      // stored, this is a no-op: skip the LLM pass entirely, mark the
      // run as completed with a no-op summary, and return. Cheapest
      // possible outcome for unchanged URLs.
      const isRecompile = source.status === "compiled"
      const hashUnchanged =
        isRecompile && source.content_hash === contentHash
      if (hashUnchanged) {
        // Refresh the metadata blob so the "last retrieved" timestamp
        // is current — useful for the freshener agent — without touching
        // content_md, title, or content_hash.
        await supabase
          .from("sources")
          .update({
            metadata: {
              ...(source.metadata ?? {}),
              final_url: retrieved.final_url,
              content_type: retrieved.content_type,
              source_kind: retrieved.source_kind,
              retrieved_at: new Date().toISOString(),
              byte_length: retrieved.byte_length,
              retrieve_ms: retrieveMs,
              last_hash_check: new Date().toISOString(),
            },
          })
          .eq("id", source_id)

        await finishRun("completed", {
          summary: "Source unchanged. No recompile.",
          detail: {
            source_title: source.title ?? null,
            stage: "hash_gate",
            hash_unchanged: true,
            retrieve_ms: retrieveMs,
          },
          compilation: {
            articles_created: 0,
            articles_updated: 0,
            edges_created: 0,
            log: {
              stage: "hash_gate",
              hash_unchanged: true,
              retrieve_ms: retrieveMs,
            },
          },
        })

        return new Response(
          JSON.stringify({
            articles_created: 0,
            articles_updated: 0,
            edges_created: 0,
            unresolved_questions: 0,
            hash_unchanged: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }

      await supabase
        .from("sources")
        .update({
          content_md: content.slice(0, 50_000),
          content_hash: contentHash,
          title: newTitle,
          metadata: {
            ...(source.metadata ?? {}),
            final_url: retrieved.final_url,
            content_type: retrieved.content_type,
            source_kind: retrieved.source_kind,
            retrieved_at: new Date().toISOString(),
            byte_length: retrieved.byte_length,
            retrieve_ms: retrieveMs,
          },
        })
        .eq("id", source_id)
    }

    if (!content.trim()) {
      await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
      await finishRun("failed", {
        summary: "No content to compile",
        detail: { stage: "compiling", error: "No content to compile" },
        compilation: { log: { stage: "compiling", error: "No content to compile" } },
      })
      return new Response(JSON.stringify({ error: "No content to compile" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ── Hash gate for non-URL sources ────────────────────────────────
    // File/text sources arrive with content_md already populated by the
    // client. Compute their hash here so re-feeds of unchanged content
    // short-circuit the same way URL sources do. Only fires when the
    // source was previously compiled and has a stored hash to compare
    // against — first-time compiles always proceed.
    if (source.source_type !== "url") {
      const fileHash = await sha256(content.trim())
      const wasCompiled = source.status === "compiled"
      if (wasCompiled && source.content_hash === fileHash) {
        await finishRun("completed", {
          summary: "Source unchanged. No recompile.",
          detail: {
            source_title: source.title ?? null,
            stage: "hash_gate",
            hash_unchanged: true,
          },
          compilation: {
            articles_created: 0,
            articles_updated: 0,
            edges_created: 0,
            log: { stage: "hash_gate", hash_unchanged: true },
          },
        })
        return new Response(
          JSON.stringify({
            articles_created: 0,
            articles_updated: 0,
            edges_created: 0,
            unresolved_questions: 0,
            hash_unchanged: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }
      if (!source.content_hash || source.content_hash !== fileHash) {
        await supabase
          .from("sources")
          .update({ content_hash: fileHash })
          .eq("id", source_id)
      }
    }

    // ══════════════════════════════════════════════════════════════
    // Two-pass compilation.
    //
    // Pass A — summarize (always runs, one LLM call).
    //   Input:  raw source content (truncated)
    //   Output: a dense summary article (article_type='summary') plus
    //           a list of concepts worth their own articles
    //   Write:  upsert the summary article row, update sources.summary_slug
    //
    // Pass B — write concept articles (one LLM call per concept).
    //   Input:  existing concept article if any + the new summary article
    //           + the flat wiki index
    //   Output: the updated concept article body
    //   Write:  upsert the concept article row, collect extracted wiki-links
    //
    // Edges are still derived from [[wikilinks]] in the generated content
    // after both passes complete.
    //
    // Separating summarize from write is the single biggest quality +
    // cost lever in the plan. Re-compiles of an unchanged source short-
    // circuit at the hash gate above. Re-compiles of a changed source
    // only re-run Pass A + the Pass B calls for concepts that actually
    // shift, not the whole pipeline. Propagation of downstream articles
    // (handled by propagate-edits) reads the short summary instead of
    // the long raw source, cutting prompt input ~10×.
    // ══════════════════════════════════════════════════════════════

    const extractWikiLinks = (md: string): string[] => {
      const matches = md.matchAll(/\[\[([a-z0-9-]+)\]\]/g)
      const slugs = new Set<string>()
      for (const m of matches) slugs.add(m[1])
      return Array.from(slugs)
    }

    const slugify = (s: string): string =>
      s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")

    const summarySlugFor = (id: string): string => `s-${id.slice(0, 8)}`

    // Load the wiki index once per run. Excludes summary rows — Pass B
    // only cares about concept/synthesis articles for wikilink targets.
    const { data: existingArticles } = await supabase
      .from("articles")
      .select("slug, title, summary, article_type")
      .eq("engram_id", source.engram_id)
      .neq("article_type", "summary")

    // Load prevention rules once per compile run. Pass A sees the
    // top-10 by weight; each Pass B call filters by tag overlap with
    // the concept being written.
    const allRules = await loadActiveRules(supabase, source.engram_id)
    const passARules = allRules.slice(0, 10)
    const injectedRuleIds = new Set<string>(passARules.map((r) => r.id))

    // Load any active prompt template overrides for this engram so the
    // user's custom guidance (if any) flows into Pass A and Pass B.
    // Fall-through to the hardcoded defaults for any template they
    // haven't overridden.
    const templates = await loadActiveTemplates(supabase, source.engram_id)
    const summarizeGuidance = guidanceFor(templates, "summarize_source")
    const writeGuidance = guidanceFor(templates, "write_concept")

    const existingSlugSet = new Set<string>(
      (existingArticles ?? []).map((a: { slug: string }) => a.slug),
    )
    const wikiIndex = (existingArticles ?? [])
      .map(
        (a: { slug: string; title: string; summary: string | null }) =>
          `- ${a.slug}: ${a.title}${a.summary ? " — " + a.summary : ""}`,
      )
      .join("\n")

    // ── Pass A — summarize ───────────────────────────────────────
    await updateStage("summarizing")

    const truncated = content.slice(0, 24_000)

    const passAResult = await runPassA({
      openaiKey,
      sourceTitle: source.title ?? "Untitled",
      sourceContent: truncated,
      preventionRules: passARules,
      guidance: summarizeGuidance.body,
    })

    if ("error" in passAResult) {
      await supabase.from("sources").update({ status: "failed" }).eq("id", source_id)
      await finishRun("failed", {
        summary: "OpenAI error during Pass A (summarize)",
        detail: { stage: "summarizing", error: passAResult.error.slice(0, 500) },
        compilation: { log: { stage: "summarizing", error: passAResult.error } },
      })
      return new Response(
        JSON.stringify({ error: "OpenAI API error (Pass A)", detail: passAResult.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const { summaryMd, concepts: conceptCandidates, unresolvedQuestions: qsFromPassA } = passAResult

    // Upsert the summary article. We use a deterministic slug so repeated
    // compiles overwrite the same row rather than stacking summaries.
    const summarySlug = summarySlugFor(source_id)
    const summaryTitle = `Summary: ${source.title ?? "Untitled"}`

    const { data: existingSummary } = await supabase
      .from("articles")
      .select("id")
      .eq("engram_id", source.engram_id)
      .eq("slug", summarySlug)
      .maybeSingle()

    if (existingSummary) {
      await supabase
        .from("articles")
        .update({
          title: summaryTitle,
          summary: conceptCandidates.length
            ? `Summary of ${source.title ?? "source"}. Concepts: ${conceptCandidates.map((c) => c.name).slice(0, 5).join(", ")}.`
            : `Summary of ${source.title ?? "source"}.`,
          content_md: summaryMd,
          article_type: "summary",
          tags: ["summary"],
          source_ids: [source_id],
          confidence: 0.9,
          metadata: { concepts: conceptCandidates, source_id },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSummary.id)
    } else {
      await supabase.from("articles").insert({
        engram_id: source.engram_id,
        slug: summarySlug,
        title: summaryTitle,
        summary: conceptCandidates.length
          ? `Summary of ${source.title ?? "source"}. Concepts: ${conceptCandidates.map((c) => c.name).slice(0, 5).join(", ")}.`
          : `Summary of ${source.title ?? "source"}.`,
        content_md: summaryMd,
        article_type: "summary",
        tags: ["summary"],
        source_ids: [source_id],
        related_slugs: [],
        confidence: 0.9,
        metadata: { concepts: conceptCandidates, source_id },
      })
    }

    // Persist the summary_slug back on the source so propagate-edits can
    // find it without regenerating.
    if (source.summary_slug !== summarySlug) {
      await supabase
        .from("sources")
        .update({ summary_slug: summarySlug })
        .eq("id", source_id)
    }

    // ── Pass B — write concept articles ──────────────────────────
    await updateStage("writing")

    // The universe of slugs Pass B can legally reference in [[wikilinks]]:
    // existing concept slugs plus any new slugs Pass B will itself create.
    // We don't know the new ones yet — assemble them progressively so
    // later concepts can link to earlier ones in the same run.
    const newSlugSet = new Set<string>(existingSlugSet)
    newSlugSet.add(summarySlug) // legal edge target even though hidden

    let articlesCreated = 0
    let articlesUpdated = 0
    const writtenConcepts: { slug: string; content_md: string; link_weights: Record<string, number> }[] = []

    for (const candidate of conceptCandidates) {
      // Resolve the concept to a slug. If it matches an existing article
      // (exact slug or fuzzy-slugified name), this is an update — else
      // a create.
      const candidateSlug = slugify(candidate.name)
      if (!candidateSlug) continue

      let existingId: string | null = null
      let existingSourceIds: string[] = []
      let existingContent: string | null = null
      let existingConfidence: number | null = null
      let existingType: string | null = null

      // Try exact slug first, then by slugified title via a case-insensitive
      // search. Cheap because the article count per engram is small.
      const { data: exact } = await supabase
        .from("articles")
        .select("id, slug, source_ids, content_md, confidence, article_type")
        .eq("engram_id", source.engram_id)
        .eq("slug", candidateSlug)
        .maybeSingle()

      if (exact) {
        existingId = exact.id
        existingSourceIds = exact.source_ids ?? []
        existingContent = exact.content_md
        existingConfidence = exact.confidence
        existingType = exact.article_type
      }

      // Filter rules by tag overlap with this concept. The candidate
      // name contributes pseudo-tags via a dumb word split so rules
      // with domain tags like "coffee" still match a concept named
      // "Coffee Plant" even before the article exists.
      const candidateTags = [
        ...candidate.name
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2),
      ]
      const passBRules = pickRulesByTagOverlap(allRules, candidateTags, 15)
      for (const r of passBRules) injectedRuleIds.add(r.id)

      const conceptResult = await runPassB({
        openaiKey,
        conceptName: candidate.name,
        conceptDefinition: candidate.definition ?? "",
        existingArticleMd: existingContent,
        newSummaryMd: summaryMd,
        wikiIndex: wikiIndex || "(empty)",
        preventionRules: passBRules,
        guidance: writeGuidance.body,
      })

      if ("error" in conceptResult) {
        console.error("[compile-source] Pass B failed for", candidate.name, conceptResult.error)
        continue
      }

      const finalSlug = exact ? exact.slug : candidateSlug
      const linkedSlugs = extractWikiLinks(conceptResult.content_md).filter(
        (s) => s !== finalSlug,
      )

      if (existingId) {
        const mergedSourceIds = [
          ...new Set([...existingSourceIds, source_id]),
        ]
        // Preserve the existing article_type on updates. The LLM's pick
        // on a re-compile is unreliable (it doesn't see enough context
        // to revisit the classification) and would otherwise clobber
        // any manual reclassification the user did from the reader.
        // Only fall through to Pass B's choice if the existing type
        // is null or somehow missing.
        const preservedType = existingType ?? conceptResult.article_type ?? "concept"
        await supabase
          .from("articles")
          .update({
            title: conceptResult.title,
            summary: conceptResult.summary,
            content_md: conceptResult.content_md,
            confidence: conceptResult.confidence ?? existingConfidence ?? 0.7,
            article_type: preservedType,
            tags: conceptResult.tags ?? [],
            source_ids: mergedSourceIds,
            related_slugs: linkedSlugs,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingId)
        articlesUpdated++
      } else {
        await supabase.from("articles").insert({
          engram_id: source.engram_id,
          slug: finalSlug,
          title: conceptResult.title,
          summary: conceptResult.summary,
          content_md: conceptResult.content_md,
          confidence: conceptResult.confidence ?? 0.7,
          article_type: conceptResult.article_type ?? "concept",
          tags: conceptResult.tags ?? [],
          source_ids: [source_id],
          related_slugs: linkedSlugs,
        })
        articlesCreated++
      }

      newSlugSet.add(finalSlug)
      writtenConcepts.push({
        slug: finalSlug,
        content_md: conceptResult.content_md,
        link_weights: conceptResult.link_weights ?? {},
      })
    }

    // ── Edges from wiki-links in the Pass B output ───────────────
    // The relation field is still hardcoded to "related" — the legend
    // categories (requires/extends/causation/...) aren't surfaced
    // anywhere on the frontend so there's no point in classifying.
    // What DOES matter is the per-edge weight: the LLM hands us
    // link_weights for every wiki-link it cites, and that number
    // drives the d3-force layout's per-link distance and strength on
    // the frontend. Strong links pull tighter, weak links pull looser.
    const edgeSet = new Set<string>()
    let edgesCreated = 0
    const insertEdge = async (from_slug: string, to_slug: string, weight: number) => {
      if (from_slug === to_slug) return
      if (!newSlugSet.has(from_slug) || !newSlugSet.has(to_slug)) return
      // Never create edges to/from the hidden summary article. Summaries
      // are plumbing, not nodes on the knowledge graph.
      if (from_slug === summarySlug || to_slug === summarySlug) return
      const key = `${from_slug}|${to_slug}`
      if (edgeSet.has(key)) return
      edgeSet.add(key)
      const { error: edgeErr } = await supabase.from("edges").insert({
        engram_id: source.engram_id,
        from_slug,
        to_slug,
        relation: "related",
        weight,
      })
      if (!edgeErr) edgesCreated++
    }

    for (const w of writtenConcepts) {
      const linked = extractWikiLinks(w.content_md)
      for (const target of linked) {
        if (target === w.slug) continue
        if (!newSlugSet.has(target)) continue
        // Look up the LLM's weight for this link, defaulting to 0.5
        // (medium) if the LLM didn't provide one. The default lands
        // mid-range so missing weights don't bias the layout in either
        // direction.
        const weight = w.link_weights[target] ?? 0.5
        await insertEdge(w.slug, target, weight)
      }
    }

    // Synthesize the `result` object the downstream propagation logic
    // uses so the existing enqueue code keeps working unchanged.
    const result = {
      articles: writtenConcepts.map((w) => ({ slug: w.slug })),
      unresolved_questions: qsFromPassA,
    }

    const unresolvedQuestions = result.unresolved_questions ?? []
    if (unresolvedQuestions.length > 0) {
      await supabase.from("sources").update({ unresolved_questions: unresolvedQuestions }).eq("id", source_id)
    }

    // ── Downstream propagation ──────────────────────────────────────
    // This is a re-compile of a source whose content actually changed
    // (the unchanged case already returned above via the hash gate).
    // Every article that cites this source but was NOT touched by the
    // write pass above needs to be re-written against the latest source
    // content. Enqueue them and hand off to propagate-edits.
    //
    // Only propagate when this is a re-compile (previous status was
    // 'compiled'). First-time compiles don't have downstream yet.
    let propagatedCount = 0
    if (source.status === "compiled") {
      // Articles the LLM just wrote or updated — already fresh.
      const justWrittenSlugs = new Set<string>(
        (result.articles ?? [])
          .map((a: { slug?: string }) => a.slug)
          .filter((s: unknown): s is string => typeof s === "string"),
      )

      // Use filter() with raw cs operator syntax. The JS client's
      // .contains() helper URL-encodes the braces in a way that can
      // fail type resolution on uuid[] columns — this literal form is
      // what PostgREST natively parses for array containment.
      //
      // Exclude article_type='summary'. The summary article for this
      // very source also cites the source (it IS the source's summary)
      // and would otherwise land in the propagation queue, wasting an
      // LLM call to re-summarize its own input.
      const { data: downstream, error: dsErr } = await supabase
        .from("articles")
        .select("slug")
        .eq("engram_id", source.engram_id)
        .neq("article_type", "summary")
        .filter("source_ids", "cs", `{${source_id}}`)

      if (dsErr) {
        console.error("[compile-source] downstream query error", dsErr)
      }

      const downstreamSlugs = (downstream ?? []).map(
        (a: { slug: string }) => a.slug,
      )
      const toEnqueue = downstreamSlugs.filter(
        (slug: string) => !justWrittenSlugs.has(slug),
      )

      if (toEnqueue.length > 0) {
        // Pre-filter against existing pending rows. The partial unique
        // index on (engram_id, article_slug) WHERE status='pending'
        // can't back an ON CONFLICT clause in Postgres (partial indexes
        // are not usable as conflict targets), so we do a read-then-
        // insert pattern instead. The index still enforces the
        // invariant as a safety net.
        const { data: existingPending } = await supabase
          .from("recompile_queue")
          .select("article_slug")
          .eq("engram_id", source.engram_id)
          .eq("status", "pending")
          .in("article_slug", toEnqueue)

        const alreadyPending = new Set<string>(
          (existingPending ?? []).map((r: { article_slug: string }) => r.article_slug),
        )
        const freshSlugs = toEnqueue.filter((s: string) => !alreadyPending.has(s))

        if (freshSlugs.length > 0) {
          const rows = freshSlugs.map((slug: string) => ({
            engram_id: source.engram_id,
            article_slug: slug,
            reason: `source:${source_id}`,
            status: "pending",
          }))
          const { error: enqErr } = await supabase
            .from("recompile_queue")
            .insert(rows)
          if (!enqErr) {
            propagatedCount = freshSlugs.length
          } else {
            console.error("[compile-source] enqueue error", enqErr)
          }
        }

        // Always invoke propagate-edits if there's anything to drain,
        // including already-pending rows from a previous compile that
        // may not have finished yet.
        if (propagatedCount > 0 || alreadyPending.size > 0) {
          supabase.functions.invoke("propagate-edits", {
            body: { engram_id: source.engram_id },
          }).catch((e) =>
            console.error("[compile-source] propagate-edits invoke failed", e),
          )
        }
      }
    }

    const summaryParts: string[] = []
    if (articlesCreated > 0) summaryParts.push(`${articlesCreated} created`)
    if (articlesUpdated > 0) summaryParts.push(`${articlesUpdated} updated`)
    if (edgesCreated > 0) summaryParts.push(`${edgesCreated} connection${edgesCreated !== 1 ? "s" : ""}`)
    if (propagatedCount > 0) summaryParts.push(`${propagatedCount} propagating`)
    const summary = summaryParts.length > 0
      ? summaryParts.join(". ") + "."
      : "No changes."

    // Bump usage counters for rules that actually landed in at least
    // one prompt this run. Fire-and-forget — analytics, not critical.
    const appliedRuleIds = Array.from(injectedRuleIds)
    if (appliedRuleIds.length > 0) {
      incrementRuleUsage(supabase, appliedRuleIds)
    }

    await finishRun("completed", {
      summary,
      detail: {
        source_title: source.title ?? null,
        articles_created: articlesCreated,
        articles_updated: articlesUpdated,
        edges_created: edgesCreated,
        propagated_queued: propagatedCount,
        rules_injected: appliedRuleIds.length,
        template_summarize: summarizeGuidance.source,
        template_write: writeGuidance.source,
        unresolved_questions: unresolvedQuestions.length,
      },
      compilation: {
        articles_created: articlesCreated,
        articles_updated: articlesUpdated,
        edges_created: edgesCreated,
        log: {
          stage: "completed",
          articles: result.articles?.length ?? 0,
          edges: edgesCreated,
          propagated_queued: propagatedCount,
          unresolved_questions: unresolvedQuestions.length,
        },
      },
    })

    await supabase.from("sources").update({ status: "compiled" }).eq("id", source_id)

    // Fire-and-forget: refresh deterministic lint findings for this engram
    // so Stats always reflects the current state. The semantic (LLM) pass
    // is NOT invoked here — it's expensive and the user can trigger it
    // manually from the Stats page via the "deep scan" button.
    supabase.functions
      .invoke("lint-engram", {
        body: { engram_id: source.engram_id, mode: "deterministic" },
      })
      .catch((e) =>
        console.error("[compile-source] deterministic lint invoke failed", e),
      )

    // --- Recount both articles AND sources ---
    // source_count is the total row count regardless of status so it
    // matches what the UI widgets (SourceTree, stats page) display.
    const { count: articleCount } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", source.engram_id)

    const { count: sourceCount } = await supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", source.engram_id)

    await supabase
      .from("engrams")
      .update({ article_count: articleCount ?? 0, source_count: sourceCount ?? 0 })
      .eq("id", source.engram_id)

    return new Response(JSON.stringify({
      articles_created: articlesCreated,
      articles_updated: articlesUpdated,
      edges_created: edgesCreated,
      propagated_queued: propagatedCount,
      unresolved_questions: unresolvedQuestions.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    await finishRun("failed", {
      summary: String(err).slice(0, 300),
      detail: { stage: "error", error: String(err) },
      compilation: { log: { stage: "error", error: String(err) } },
    })
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
