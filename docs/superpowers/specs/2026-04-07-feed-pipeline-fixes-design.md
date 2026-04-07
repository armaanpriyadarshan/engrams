# Feed Pipeline Fixes — Design Spec

**Date:** 2026-04-07
**Scope:** File parsing, URL extraction, feed progress UI, source dedup & count accuracy

---

## Problem Statement

The feed pipeline has four issues:

1. **File parsing fails silently.** The `parse-file` Edge Function uses homebrew regex extraction (reading raw bytes as latin1, regex-matching PDF operators and XML tags). This fails on most real PDFs (compressed streams, font encodings) and DOCX/PPTX files (deflated zip entries). Result: empty content, no articles created, no error shown.

2. **URL extraction is too naive.** The `compile-source` Edge Function fetches URLs with a simple `fetch()` and strips HTML via regex. Fails on SPAs (empty `<div id="root">`), auth-protected sites (redirects), and complex pages where nav/footer removal isn't enough.

3. **No progress feedback during compilation.** After "Source added. Compiling..." the UI is silent for 10-30 seconds until the Edge Function returns. The `compilation_runs` table already supports Realtime but the frontend doesn't subscribe to it.

4. **Source count is inflated and duplicates aren't detected.** `increment_source_count` fires on the frontend immediately after source insert, before compilation. Duplicate URLs and identical files each create new source rows and increment the count.

---

## Design

### 1. File Parsing — `parse-file` Edge Function Rewrite

Replace the homebrew parsers with proper libraries. The function signature is unchanged: `{ file_base64, filename, format }` in, `{ content, filename }` out. No frontend changes needed.

#### Libraries

| Format | Library | Import | Notes |
|--------|---------|--------|-------|
| PDF | `unpdf` | `import { extractText, getDocumentProxy } from "npm:unpdf"` | Wraps Mozilla PDF.js in a serverless-optimized build (pdfjs-serverless). Confirmed working in Supabase Edge Functions. Handles compressed streams, font encodings, CIDFonts. |
| DOCX | `mammoth` | `import mammoth from "npm:mammoth"` | Handles zip decompression + XML parsing internally. Use `arrayBuffer` input mode to avoid Node fs calls. |
| PPTX | `JSZip` + XML parsing | `import JSZip from "npm:jszip"` | Properly unzip the archive, then extract `<a:t>` text nodes from `ppt/slides/slide*.xml` files. |
| XLSX | `JSZip` + XML parsing | Same | Unzip, parse `xl/sharedStrings.xml` for string table, `xl/worksheets/sheet*.xml` for cell references. Reconstruct cell values row by row. |
| CSV/TXT/MD | Keep as-is | `TextDecoder` | Works fine, no change. |

#### Implementation

```typescript
// PDF
const pdf = await getDocumentProxy(new Uint8Array(bytes));
const { text } = await extractText(pdf, { mergePages: true });

// DOCX
const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
const text = result.value;

// PPTX
const zip = await JSZip.loadAsync(bytes);
const slideFiles = Object.keys(zip.files)
  .filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/))
  .sort();
let text = "";
for (const slideFile of slideFiles) {
  const xml = await zip.file(slideFile).async("text");
  // Extract <a:t>...</a:t> text nodes
  const matches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
  for (const m of matches) text += m[1] + " ";
  text += "\n\n"; // slide boundary
}

// XLSX
const zip = await JSZip.loadAsync(bytes);
const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("text");
// Parse shared string table, then iterate worksheets for cell values
```

#### Error handling

If a library throws or returns empty content, return `{ error: "Could not extract text from file" }` with status 422. The frontend already handles this and shows "Could not parse file."

---

### 2. URL Content Extraction — `compile-source` Edge Function

Replace the regex HTML stripping with Mozilla's Readability algorithm.

#### Libraries

| Library | Import | Purpose |
|---------|--------|---------|
| `@mozilla/readability` | `import { Readability } from "npm:@mozilla/readability"` | Extract main content from HTML (same algorithm as Firefox Reader View) |
| `linkedom` | `import { parseHTML } from "npm:linkedom"` | DOM parser for Deno (Readability needs a DOM) |

#### Flow

```
fetch(url)
  → parse HTML with linkedom
  → run Readability to extract article content
  → if Readability returns content with > 50 chars, use it
  → else fall back to current regex stripping
  → if still < 50 chars, mark source as "failed", return error
```

#### Implementation (replaces the URL-fetch block in compile-source)

```typescript
if (source.source_type === "url" && source.source_url && !content) {
  try {
    const res = await fetch(source.source_url, {
      headers: { "User-Agent": "Engrams/1.0 (knowledge compiler)" },
    });
    const html = await res.text();

    // Try Readability first
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (article?.textContent && article.textContent.trim().length > 50) {
      content = article.textContent.trim();
      // Use article title if source has no title
      if (!source.title && article.title) {
        await supabase.from("sources").update({ title: article.title }).eq("id", source_id);
      }
    } else {
      // Fallback: regex strip (existing approach)
      content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        // ... existing regex chain ...
        .trim();
    }

    if (content.length > 50) {
      await supabase.from("sources")
        .update({ content_md: content.slice(0, 50000) })
        .eq("id", source_id);
    } else {
      await supabase.from("sources").update({ status: "failed" }).eq("id", source_id);
      return error("Could not extract content from this URL.");
    }
  } catch {
    await supabase.from("sources").update({ status: "failed" }).eq("id", source_id);
    return error("Failed to fetch URL.");
  }
}
```

#### Limitations (accepted)

- SPAs that render entirely client-side will still fail. This is inherent without a headless browser.
- Auth-protected pages will still fail. The error message makes this clear.

---

### 3. Feed Progress UI

Use the existing `compilation_runs` table with Realtime to show stages.

#### Edge Function changes (compile-source)

Add `log` updates at each stage. The `compilation_runs.log` column (jsonb) stores the current stage:

```typescript
// After creating the compilation run:
const updateStage = async (stage: string) => {
  await supabase.from("compilation_runs")
    .update({ log: { stage } })
    .eq("id", run?.id);
};

await updateStage("fetching");    // URL sources only
// ... fetch URL content ...

await updateStage("compiling");
// ... call OpenAI ...

await updateStage("writing");
// ... write articles and edges ...

// Final update (already exists):
await supabase.from("compilation_runs").update({
  status: "completed",
  // ... existing fields ...
}).eq("id", run?.id);
```

#### Frontend changes (feed/page.tsx)

After firing `compile-source` (without awaiting), subscribe to the compilation run:

```typescript
// Fire compilation without blocking
supabase.functions.invoke("compile-source", { body: { source_id: source.id } });

// Subscribe to compilation_runs for this source
const channel = supabase
  .channel(`compilation-${source.id}`)
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "compilation_runs",
    filter: `source_id=eq.${source.id}`,
  }, (payload) => {
    const run = payload.new;
    const stage = run.log?.stage;

    if (run.status === "completed") {
      setMessage(`Compilation complete. ${run.articles_created} created. ${run.articles_updated} updated. ${run.edges_created} connections found.`);
      setCompiling(false);
      channel.unsubscribe();
      // Trigger background tasks + snapshot + refresh
    } else if (run.status === "failed") {
      setMessage("Compilation failed.");
      setCompiling(false);
      channel.unsubscribe();
    } else if (stage === "fetching") {
      setMessage("Fetching content...");
    } else if (stage === "compiling") {
      setMessage("Compiling...");
    } else if (stage === "writing") {
      setMessage("Writing articles...");
    }
  })
  .subscribe();
```

#### UI behavior

- Same position as current message (below the feed button)
- Same styles: `text-xs text-agent-active` during progress, `text-text-tertiary` on completion
- Stages replace each other in place, no stacking
- Cleanup: unsubscribe on completion, failure, or component unmount

---

### 4. Source Dedup & Count Accuracy

#### Remove premature count increment

Delete the `increment_source_count` RPC call from `feed/page.tsx` (line 54).

#### Recount in Edge Function

At the end of `compile-source`, after marking the source as `"compiled"`, recount both articles and sources:

```typescript
// Already exists for articles:
const { count: articleCount } = await supabase
  .from("articles")
  .select("id", { count: "exact", head: true })
  .eq("engram_id", source.engram_id);

// Add for sources:
const { count: sourceCount } = await supabase
  .from("sources")
  .select("id", { count: "exact", head: true })
  .eq("engram_id", source.engram_id)
  .eq("status", "compiled");

await supabase.from("engrams").update({
  article_count: articleCount ?? 0,
  source_count: sourceCount ?? 0,
}).eq("id", source.engram_id);
```

Only sources with `status: "compiled"` are counted. Failed/pending sources don't inflate the number.

#### Dedup logic on the frontend (feed/page.tsx)

Before inserting a new source, check for existing matches:

**URL sources — identity is the URL:**
```typescript
const { data: existing } = await supabase
  .from("sources")
  .select("id")
  .eq("engram_id", engram.id)
  .eq("source_url", content.trim())
  .limit(1)
  .maybeSingle();

if (existing) {
  // Update existing source, reset for recompilation
  await supabase.from("sources").update({
    content_md: null,
    status: "pending",
  }).eq("id", existing.id);
  setMessage("Source updated. Recompiling...");
  // Trigger compilation with existing.id
}
```

**Text sources — identity is content hash:**
```typescript
const hash = await sha256(content.trim());
const { data: existing } = await supabase
  .from("sources")
  .select("id")
  .eq("engram_id", engram.id)
  .eq("content_hash", hash)
  .limit(1)
  .maybeSingle();

if (existing) {
  setMessage("This content has already been fed.");
  return;
}
// Insert with content_hash: hash
```

**File sources — identity is filename (title) within the engram:**
```typescript
const hash = await sha256(content);
const { data: existing } = await supabase
  .from("sources")
  .select("id, content_hash")
  .eq("engram_id", engram.id)
  .eq("title", filename)
  .limit(1)
  .maybeSingle();

if (existing) {
  if (existing.content_hash === hash) {
    setMessage("This content has not changed.");
    return;
  }
  // Same file, new content — update and recompile
  await supabase.from("sources").update({
    content_md: content,
    content_hash: hash,
    status: "pending",
  }).eq("id", existing.id);
  setMessage("Source updated. Recompiling...");
  // Trigger compilation with existing.id
}
```

**SHA-256 helper:**
```typescript
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
```

#### Messages

| Scenario | Message |
|----------|---------|
| Same URL re-fed | "Source updated. Recompiling..." |
| Same file, new content | "Source updated. Recompiling..." |
| Same file, identical content | "This content has not changed." |
| Same text pasted verbatim | "This content has already been fed." |
| New source | "Source added. Compiling..." (existing) |

---

## Files Changed

| File | Change |
|------|--------|
| `parse-file` Edge Function | Rewrite: replace regex parsers with unpdf, mammoth, JSZip |
| `compile-source` Edge Function | URL extraction: add Readability + linkedom. Progress: add stage updates to compilation_runs.log. Count: recount sources at end. |
| `apps/web/app/app/[engram]/feed/page.tsx` | Add dedup checks, Realtime subscription for progress, remove `increment_source_count` RPC, add SHA-256 hashing |

No database migrations needed. The `content_hash` column already exists on `sources`.

---

## Not in scope

- Headless browser rendering for SPA URLs
- External parsing APIs (Jina, Firecrawl)
- Streaming compilation results (article-by-article)
- Changes to the ask/query pipeline
- Changes to the MCP server's feed tool (uses Edge Functions directly, will benefit from the fixes automatically)
