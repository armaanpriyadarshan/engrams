# How Engrams works

A comprehensive walkthrough of the actual current implementation — not the spec, what's running in production right now. Includes a comparison with Obsidian + Claude Code, the live core loop, and how the graph is built and rendered.

## Obsidian + Claude Code

Obsidian is a **local markdown file editor** with no compilation step. You write notes by hand. The workflow:

- Every note is a `.md` file in a folder you own (the "vault")
- You manually create links by typing `[[note name]]` in your prose
- Obsidian indexes those links into a graph view (force-directed, like ours)
- A backlinks panel shows you every other note that links to the current one
- Plugins can do extras (Dataview, Templater, Smart Connections), but the source of truth is always your handwritten markdown

**Adding Claude Code on top** is straightforward because the vault is just files. You `cd` into the vault, run `claude`, and now Claude can `Read`, `Edit`, `Write`, and `Grep` your notes. You ask it things like "summarize all my notes from this week into a weekly review" and it writes a new `.md` file. It can:

- Read existing notes for context
- Write new notes that link to existing ones using `[[wiki link]]` syntax (which Obsidian then renders)
- Refactor link structures, fix broken backlinks, generate indexes
- Search across the vault with grep
- Edit notes inline

You can also point it at an Obsidian MCP server (community plugins like `obsidian-mcp`) which gives it access to Obsidian's actual link graph, daily-note metadata, and tags rather than parsing markdown by hand.

The mental model: **Claude is a smart collaborator editing the same files you would**. The graph and the wiki are emergent properties of the markdown — there's no compilation, no LLM in the loop unless you explicitly invoke one, no server-side state. Everything is local files. If you delete the vault folder, your knowledge is gone with it.

## How Engrams differs

The fundamental difference: **Obsidian's wiki is what you wrote. Engrams' wiki is what an LLM compiled from raw inputs you fed in.**

| | Obsidian + Claude Code | Engrams |
|---|---|---|
| **Source of truth** | Your handwritten markdown notes | Raw "sources" (URLs, text, files) → LLM-derived "articles" |
| **Linking** | Manual `[[wiki links]]` you type | Compiler emits `[[slug]]` references and edge rows |
| **Where it lives** | Local filesystem | Hosted Postgres (Supabase) |
| **When LLM runs** | When you ask Claude to do something | Automatically every time you feed a source |
| **Backlinks** | Computed from `[[link]]` parsing | Stored as `edges` table rows |
| **Graph** | Vault-wide view of file links | Per-engram view of compiled articles |
| **Provenance** | Implicit (git blame, file history) | Explicit: every article tracks `source_ids` |
| **Multi-device** | Sync via iCloud/Git/Obsidian Sync | Built-in (it's a webapp on Postgres) |
| **Editing** | You edit files directly | You feed raw material; the LLM rewrites it as articles |
| **Failure mode** | A bad note is a bad note | A bad compilation produces a wrong article. You can't easily edit it because it'll get overwritten on recompile |

In short: Obsidian treats you as the author and the LLM as a tool. Engrams treats the LLM as the author and you as the source provider. That's the philosophical difference — and most of the implementation flows from it.

## Current core loop (what actually runs)

Three round trips between the browser and Supabase. Everything stateful lives in Postgres; the "intelligence" lives in OpenAI calls inside edge functions.

### 1. Feed (browser → DB → edge function → DB)

When you click Feed → URL/text/file:

1. The browser inserts a row into `sources` with `status: 'pending'` and the raw content (or a URL).
2. The browser invokes the `compile-source` edge function with `{ source_id }`.
3. `compile-source` runs entirely server-side in Deno on Supabase's edge:
   - Loads the source row.
   - If it's a URL, fetches the page, strips HTML tags, truncates to ~24k chars.
   - Reads the **wiki index** for that engram — a flat list of every existing article's slug + title + summary.
   - Inserts a `compilation_runs` row with `status: 'running'` (the browser is subscribed to this via Supabase Realtime, which is how the live compilation toast updates).
   - Calls **OpenAI gpt-4o-mini** with one big prompt: "here's the source, here's the existing wiki index, return JSON with an `articles` array, an `edges` array, and an `unresolved_questions` array. For every new article, link it to existing ones."
   - Parses the JSON response.
   - For each article in the response:
     - If `action: 'update'` and the slug exists, updates the row, merges `source_ids`, merges `related_slugs`.
     - Otherwise inserts a new row in `articles`.
   - Extracts `[[slug]]` references from each article's `content_md` (regex match) — this is the safety net. Any inline reference to an existing slug becomes an edge in the `edges` table even if the model forgot to put it in the `edges` array.
   - Inserts those edges plus the model's explicit edges, deduped, only if both endpoints exist.
   - Updates the `compilation_runs` row to `status: 'completed'` with counts and a log object.
   - Updates `engrams.article_count` and stores the unresolved questions on the source.
4. The browser sees the realtime update from `compilation_runs`, and `useGraphData` re-fetches because it subscribes to the same channel.

For the **Coffee sample specifically**, the WelcomeScreen does this 9 times sequentially — inserting all 9 source rows in one batch first, then awaiting `compile-source` for each one in order so the wiki index grows between calls. It blocks navigation until the loop finishes (with a progress indicator).

### 2. Read

There's no compilation here. `useGraphData` runs two parallel queries against Supabase from the browser:

```sql
SELECT slug, title, summary, confidence, article_type, tags, source_ids, related_slugs, content_md
  FROM articles WHERE engram_id = $1

SELECT from_slug, to_slug, relation, weight FROM edges WHERE engram_id = $1
```

It then constructs a `GraphData` object: nodes built from articles, edges built **strictly from the `edges` table** (the implicit `related_slugs` synthesis was removed because it inflated counts and confused the metrics).

The wiki view groups articles by `article_type`, sorts them, and shows them as a list. The article reader page is just a server-rendered Next.js route that does another query and renders markdown via `react-markdown` with custom components for `[[slug]]` links.

### 3. Ask (streaming)

When you submit a question in AskBar:

1. The browser does a raw `fetch` (not `supabase.functions.invoke`, because that doesn't expose response bodies) directly to `/functions/v1/ask-engram`.
2. The edge function returns a Server-Sent Events stream. Inside the stream:
   - **Plan step** (non-streaming): a fast `gpt-4o-mini` call with the article index and your question, returning a JSON `{ slugs: [...] }` of up to 8 article slugs. Sent to the browser as an `articles` event.
   - **Synth step** (streaming): another `gpt-4o-mini` call with the full content of those selected articles + your conversation history + your question. `stream: true`. The function reads OpenAI's SSE format byte-by-byte, parses each chunk, extracts the `delta.content`, and re-emits it as a `delta` event in our own SSE format.
   - **Followup step** (non-streaming): a third `gpt-4o-mini` call with the question + the full answer text, asking for 3 short followup questions. Sent as a `followups` event.
   - **Done event**: the function writes the final answer + slugs + followups into the `queries` table for history, then closes the stream.
3. The browser reads the SSE stream with a `ReadableStreamDefaultReader`, parses `data: ...` lines, and updates the current turn's state on each event. The UI shows answer text appearing word-by-word with a pulsing cursor.

The conversation history is sent to the synth step as standard OpenAI message turns (alternating user/assistant), so when you click a followup it actually has prior context — not just a new isolated question.

There is no semantic search in the ask path. The `semantic-search` edge function exists separately but isn't wired into the planner. The planner picks articles by reading the title/summary index, not by embedding similarity.

### Background work that's deployed but quiet

These edge functions exist but most are best-effort fire-and-forget:

- **`generate-embedding`**: walks all articles in an engram, embeds their `content_md` with OpenAI's embedding model, stores them in a `pgvector` column. The `semantic-search` function uses these but, again, the ask path doesn't.
- **`detect-gaps`**: runs after compilation, looks at unresolved questions across sources and articles with low confidence, populates the `knowledge_gaps` table. The Knowledge Gaps widget reads this.
- **`lint-engram`**: scans for contradictions, drift, stale articles, unsupported claims. Populates `lint_findings`.
- **`sync-integration`**: invoked by `pg_cron` every 30 minutes for connected GitHub/Notion/Google Drive integrations. Pulls new sources and feeds them through `compile-source`.
- **`parse-file`**: takes binary uploads (PDF, DOCX, PPTX, XLSX) and turns them into markdown text the compiler can read.

None of these run continuously. They're all triggered by either: (a) the browser explicitly invoking them after a compilation completes, or (b) `pg_cron` on a schedule.

## How the graph works

Three layers: data → layout → render.

### Data layer (`useGraphData`)

Pulls articles + edges from Postgres on mount. Builds a `GraphData` object:

```ts
{
  nodes: GraphNode[],   // one per article
  edges: GraphEdge[],   // one per edges-table row, deduped by undirected pair
  slugToIndex: Map<string, number>
}
```

It also computes a `depth` value per node — which is `wordCount * sourceCount`, normalized 0-1 against the max in the engram. This drives the node size and Z-position later. Bigger, better-sourced articles sit closer to the camera and render larger.

The hook subscribes to `compilation_runs` via Supabase Realtime — when a run completes, it bumps a `refreshKey` which triggers a re-fetch.

### Layout layer (`useForceLayout`)

Pure d3-force simulation, run synchronously inside `useMemo`. No animation — it ticks 100-300 times in a tight loop and produces a static `Float32Array` of `[x, y, x, y, ...]` positions.

Forces:

- **link**: pulls connected nodes toward each other at distance 25
- **charge**: repels every node from every other (`-20 - min(nodeCount, 60)`)
- **center**: gentle pull toward (0, 0)
- **collide**: prevents overlap, radius scales with depth

It caches positions by slug across re-runs, so adding a new article doesn't re-shuffle the entire graph — existing nodes start at their previous positions, only new ones drift to a fit.

After ticking, it normalizes everything to fit within a target radius (`100 + min(nodeCount * 3, 150)` world units), so the graph stays compact regardless of node count.

### Render layer (`EngineGraph`)

Three.js / WebGL, not SVG. The whole graph is **two draw calls**:

1. **Edges**: a single `LineSegments` object. One vertex pair per edge, colored per `relation` (`related = grey`, `requires = brown`, `extends = blue`, etc.). Brightness scales with edge weight.
2. **Nodes**: a single `Points` object with a custom GLSL shader. Each node is a billboarded point sprite. The shader computes a soft-edged glow falloff per fragment, modulated by:
   - Pulse (sin wave + node phase, slow breathing)
   - Mouse proximity (a smoothstep over distance, makes hovered nodes brighter)
   - Depth-from-camera (atmospheric fade)
   - Per-node fade target (drops to 0.08 when another node is hovered to dim non-neighbors)

The Z position of each node is `-300 + depth * 500`, so deeper articles sit further from the camera and look smaller through perspective projection.

**Hover detection** is done in JS, not via raycasting. Every frame, every node is projected to screen space and the distance to the cursor is computed in pixels. Closest within 25px wins. Then the hover sets a tooltip and recomputes the per-node fade targets.

**Interaction:**

- Mouse wheel = zoom (interpolates `targetZ` toward camera Z)
- Left-click drag on empty space = pan (`panOffset.x/y` updated by delta)
- Right-click drag = orbit (yaw/pitch, computed in spherical coords around the lookAt point — clamped to ±60° vertical so you can't flip)
- Click on a node = invokes `onNodeClick(slug, screenX, screenY)`, which the page uses to open the node menu / NodeCard

There's a **filter pass** applied via the `nodeVisible` `Uint8Array` passed in from the page. If a node is filtered out (by type, confidence, or search query), its `aFade` attribute is multiplied by ~0 so the shader effectively hides it. Edges also dim if either endpoint is filtered.

There are **signal particles** — 60 small dots that travel along edges, randomized phase. Pure decoration.

The whole thing runs in `requestAnimationFrame`. There's a slow camera drift (`Math.sin(elapsed * 0.015) * 20`) that gives the graph that "breathing" feel even when idle. This is the `cinematic` transition the design system mentions.

### Why the graph isn't a hard problem

It's only ever a few hundred articles. WebGL doesn't break a sweat with 200 nodes and 300 edges — the whole loop runs at 60fps. The interesting engineering is the **shader for the soft glow** and the **per-node fade interpolation** that makes hover highlighting feel smooth instead of binary. Everything else is standard force-directed graph stuff that d3 has been doing for a decade.

## Where the seams show up

Now that the architecture is described, here are the gaps that are honest to call out:

1. **The compilation prompt is the whole product.** The "intelligence" of an engram is essentially "what gpt-4o-mini decides is interesting in the source". There's no preprocessing, no chunking, no per-domain prompting. A bad source produces a bad article and there's no human edit step.
2. **Edges are sparse because the planner sees a flat index.** The compile prompt asks for cross-links but the model often returns 0 edges per source. The auto-extracted `[[slug]]` references are the safety net, but they only help if the model writes the link in prose.
3. **Ask doesn't use embeddings.** The planner reads the article index as text and picks slugs. For 9 articles that's fine. For 900 articles the index won't fit in the context window and you'll need to switch the planner to vector retrieval.
4. **Background agents are mostly fire-and-forget.** When they fail, nothing tells the user. The activity widget shows compilation runs but not lint/embed/gap-detect failures.
5. **No human editing of articles.** If the LLM gets something wrong, the only recovery is "feed a new source that contradicts it" and hope the next compile fixes it. There's no "edit this article" button.
6. **The edges table is the source of truth, but it's also fragile.** Edges are slug-strings, not foreign keys. Rename a slug and edges pointing to the old name silently dangle. (We rely on `useGraphData` filtering them out at render time.)

Those aren't bugs — they're the accumulated cost of "every article is an LLM output". Some are fixable (better retrieval, edit-as-override), some are inherent (the LLM is the author, you're the source provider).

## TL;DR

If you want a one-line summary of why this is different from Obsidian + Claude Code: **Obsidian gives Claude a vault to read and edit; Engrams gives Claude a pile of raw material and asks it to write the wiki itself.** The first treats you as author. The second treats the LLM as author. Everything else is a downstream consequence of that choice.
