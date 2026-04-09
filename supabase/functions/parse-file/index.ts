// parse-file — turn an uploaded file into markdown for the compiler.
//
// Sprint 3.5 expansion. Existing handlers (PDF, DOCX, PPTX, XLSX,
// plain text) are preserved; new handlers added for:
//
//   epub  — ZIP of XHTML; concatenate body text in spine-ish order
//   eml   — RFC 822 mail; pull text/plain part if multipart
//   csv   — emit a markdown table (cap 500 rows for prompt budget)
//   vtt   — WebVTT transcript; strip cue timing + headers
//   srt   — SRT subtitle; strip sequence numbers + timing
//
// Each new format is a small extract function that returns markdown
// the compile pipeline can ingest as if it were any other source.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { extractText, getDocumentProxy } from "npm:unpdf"
import mammoth from "npm:mammoth"
import JSZip from "npm:jszip"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

const MAX_OUTPUT_CHARS = 100_000
const MAX_CSV_ROWS = 500

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

  const finishRun = async (
    status: "completed" | "failed",
    summary: string,
    detail: Record<string, unknown> = {},
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
      .catch(() => {})
  }

  try {
    const body = await req.json()
    const { file_base64, filename, format, engram_id } = body

    if (!file_base64 || !format) {
      return json({ error: "file_base64 and format required" }, 400)
    }

    if (engram_id) {
      const { data: runRow } = await supabase
        .from("agent_runs")
        .insert({
          engram_id,
          agent_type: "parse_file",
          status: "running",
          detail: { filename: filename ?? "file", format },
        })
        .select("id")
        .single()
      agentRunId = runRow?.id ?? null
    }

    const binaryStr = atob(file_base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

    let content = ""

    switch (format.toLowerCase()) {
      case "pdf":
        content = await extractPDF(bytes)
        break
      case "docx":
        content = await extractDOCX(bytes)
        break
      case "pptx":
        content = await extractPPTX(bytes)
        break
      case "xlsx":
        content = await extractXLSX(bytes)
        break
      case "epub":
        content = await extractEPUB(bytes)
        break
      case "eml":
        content = extractEML(bytes)
        break
      case "csv":
        content = extractCSV(bytes)
        break
      case "vtt":
        content = extractVTT(bytes)
        break
      case "srt":
        content = extractSRT(bytes)
        break
      default:
        // text, markdown, code files, log, json, etc all fall through
        // to a plain-text decode. The compiler treats them as raw
        // markdown content.
        content = new TextDecoder().decode(bytes)
        break
    }

    if (!content.trim()) {
      await finishRun("failed", "Could not extract text from file", {
        filename,
        format,
      })
      return json({ error: "Could not extract text from file" }, 422)
    }

    const truncated = content.slice(0, MAX_OUTPUT_CHARS)
    await finishRun(
      "completed",
      `${filename ?? format} parsed (${truncated.length.toLocaleString()} chars)`,
      { filename, format, chars: truncated.length },
    )

    return json({ content: truncated, filename })
  } catch (err) {
    await finishRun("failed", String(err).slice(0, 300), {
      error: String(err),
    })
    return json({ error: String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// ───────────────────────────────────────────────────────────────
// PDF / DOCX / PPTX / XLSX — preserved from the prior version
// ───────────────────────────────────────────────────────────────

async function extractPDF(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

async function extractDOCX(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  })
  return result.value
}

async function extractPPTX(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
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

  const sharedStrings: string[] = []
  const ssFile = zip.file("xl/sharedStrings.xml")
  if (ssFile) {
    const ssXml = await ssFile.async("text")
    for (const m of ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) {
      sharedStrings.push(m[1])
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
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

// ───────────────────────────────────────────────────────────────
// EPUB
//
// EPUBs are ZIPs of XHTML. The strict path: read META-INF/container.xml
// → find the OPF → walk the spine in order → resolve manifest → read
// each XHTML file. The lazy path: just grab every .xhtml/.html file
// from OEBPS/ or the like, sort alphabetically (which usually matches
// the natural reading order because EPUB conventions name chapters
// chap01.xhtml, chap02.xhtml, etc.), and concatenate.
//
// We do the lazy path because it works for ~95% of EPUBs and avoids
// the OPF/spine parsing complexity. If a future user complains about
// out-of-order chapters, the strict path is the upgrade.
// ───────────────────────────────────────────────────────────────

async function extractEPUB(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)

  // EPUBs commonly put content under OEBPS/, EPUB/, or at root.
  // Filter to .xhtml/.html and sort by path so chap01 comes before chap02.
  const contentFiles = Object.keys(zip.files)
    .filter((f) => /\.(xhtml|html)$/i.test(f))
    .filter((f) => !/^META-INF\//i.test(f)) // skip container/manifest XHTML
    .sort()

  const chapters: string[] = []
  for (const path of contentFiles) {
    const xml = await zip.file(path)!.async("text")
    // Pull only the body content. The body tag is usually present;
    // if not, fall back to the whole document.
    const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const body = bodyMatch ? bodyMatch[1] : xml
    const text = stripHtmlToText(body)
    if (text.length > 20) chapters.push(text)
  }

  return chapters.join("\n\n---\n\n")
}

// Strip HTML tags and decode common entities. Used by EPUB and EML
// (when an email is HTML-bodied).
function stripHtmlToText(html: string): string {
  return (
    html
      // Drop script/style content entirely.
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Block elements become paragraph breaks.
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Strip the rest.
      .replace(/<[^>]+>/g, "")
      // Decode common entities.
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace.
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

// ───────────────────────────────────────────────────────────────
// EML — RFC 822 mail
//
// Headers, blank line, body. Multipart messages have a Content-Type
// of multipart/* with a boundary; we look for the first text/plain
// part and use that, falling back to text/html stripped to plain
// text if no plain part exists.
// ───────────────────────────────────────────────────────────────

function extractEML(bytes: Uint8Array): string {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  // Split headers from body at the first blank line.
  const splitIdx = raw.search(/\r?\n\r?\n/)
  if (splitIdx < 0) return raw
  const headers = raw.slice(0, splitIdx)
  const body = raw.slice(splitIdx).replace(/^\r?\n\r?\n/, "")

  // Pluck the headers we care about.
  const headerOf = (name: string): string => {
    const re = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, "im")
    const m = headers.match(re)
    return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : ""
  }
  const from = headerOf("From")
  const to = headerOf("To")
  const subject = headerOf("Subject")
  const date = headerOf("Date")
  const contentType = headerOf("Content-Type").toLowerCase()

  let bodyText = ""
  if (contentType.startsWith("multipart/")) {
    // Find boundary, walk parts, prefer text/plain over text/html.
    const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/)
    if (boundaryMatch) {
      const boundary = boundaryMatch[1]
      const parts = body.split(new RegExp(`--${escapeRegExp(boundary)}`))
      let plain = ""
      let html = ""
      for (const part of parts) {
        const partSplit = part.search(/\r?\n\r?\n/)
        if (partSplit < 0) continue
        const partHeaders = part.slice(0, partSplit).toLowerCase()
        const partBody = part.slice(partSplit).replace(/^\r?\n\r?\n/, "")
        if (partHeaders.includes("content-type: text/plain")) {
          plain ||= partBody
        } else if (partHeaders.includes("content-type: text/html")) {
          html ||= partBody
        }
      }
      bodyText = plain || (html ? stripHtmlToText(html) : "")
    }
  } else if (contentType.startsWith("text/html")) {
    bodyText = stripHtmlToText(body)
  } else {
    bodyText = body
  }

  // Reassemble as a markdown-ish document so the compiler has structure.
  const lines: string[] = []
  if (subject) lines.push(`# ${subject}`)
  if (from) lines.push(`**From:** ${from}`)
  if (to) lines.push(`**To:** ${to}`)
  if (date) lines.push(`**Date:** ${date}`)
  lines.push("")
  lines.push(bodyText.trim())
  return lines.join("\n")
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ───────────────────────────────────────────────────────────────
// CSV — emit a markdown table
//
// Simple state-machine parser that handles quoted fields with commas
// and escaped double quotes inside quotes ("" → "). Returns a markdown
// table with the first row as the header. Caps at MAX_CSV_ROWS rows
// after the header to keep the prompt budget reasonable.
// ───────────────────────────────────────────────────────────────

function extractCSV(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  const rows = parseCsv(text)
  if (rows.length === 0) return ""

  const header = rows[0]
  const dataRows = rows.slice(1, 1 + MAX_CSV_ROWS)
  const truncated = rows.length - 1 > MAX_CSV_ROWS

  const lines: string[] = []
  lines.push("| " + header.map(escapePipe).join(" | ") + " |")
  lines.push("| " + header.map(() => "---").join(" | ") + " |")
  for (const row of dataRows) {
    // Pad short rows to header width so the markdown table stays valid.
    const padded = row.concat(
      Array(Math.max(0, header.length - row.length)).fill(""),
    )
    lines.push("| " + padded.slice(0, header.length).map(escapePipe).join(" | ") + " |")
  }
  if (truncated) {
    lines.push(
      `\n_Truncated to ${MAX_CSV_ROWS} of ${rows.length - 1} rows._`,
    )
  }
  return lines.join("\n")
}

function escapePipe(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ",") {
      current.push(field)
      field = ""
      i++
      continue
    }
    if (c === "\n" || c === "\r") {
      // Handle CRLF: skip the \n after a \r.
      if (c === "\r" && text[i + 1] === "\n") i++
      current.push(field)
      // Skip empty trailing rows.
      if (current.length === 1 && current[0] === "") {
        // empty row
      } else {
        rows.push(current)
      }
      current = []
      field = ""
      i++
      continue
    }
    field += c
    i++
  }
  // Last field
  if (field.length > 0 || current.length > 0) {
    current.push(field)
    rows.push(current)
  }
  return rows
}

// ───────────────────────────────────────────────────────────────
// VTT / SRT — subtitle / transcript files
//
// Both formats interleave timing lines with cue text lines, separated
// by blank lines. We strip everything that isn't cue text and join
// the cues into a single block of prose. WebVTT additionally has a
// `WEBVTT` header line at the top and may have NOTE blocks; we drop
// both. SRT has numeric sequence numbers between blocks.
// ───────────────────────────────────────────────────────────────

function extractVTT(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inNote = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      inNote = false
      continue
    }
    if (/^WEBVTT/i.test(trimmed)) continue
    if (/^NOTE/i.test(trimmed)) {
      inNote = true
      continue
    }
    if (inNote) continue
    // Timing lines look like "00:00:01.000 --> 00:00:02.500"
    if (/-->/.test(trimmed)) continue
    // VTT cue identifiers can be a single word/number; skip lines that
    // are just digits.
    if (/^\d+$/.test(trimmed)) continue
    out.push(trimmed)
  }
  return out.join(" ")
}

function extractSRT(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^\d+$/.test(trimmed)) continue
    if (/-->/.test(trimmed)) continue
    out.push(trimmed)
  }
  return out.join(" ")
}
