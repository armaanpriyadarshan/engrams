# Progress

Last updated: 2026-04-06

## Overview

Engrams is in active development. Phase 1 (Core Loop) is ~95% complete. Phase 2 (Visualizations + Intelligence) is ~85% complete. The web app is functional end-to-end: users can create engrams, feed sources, compile articles, browse the knowledge graph, ask questions, see answers filed back into the wiki, track version history via snapshots, and search semantically via embeddings.

---

## Phase 1 — Core Loop

### Done

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Next.js skeleton + Supabase project | Done | Next.js 16, React 19, Tailwind 4, Supabase SSR |
| 2 | Auth: login, signup, session management | Done | Email/password, Google OAuth, middleware protection, callback route |
| 3 | Design system: globals.css, fonts, tokens | Done | All color tokens, Space Grotesk/DM Sans/JetBrains Mono, animations, reader width, highlight.js theme |
| 4 | App shell: sidebar + topbar + main | Done | Collapsible sidebar with engram list, accent dots, create/delete, compilation pulse in topbar |
| 5 | Engram CRUD | Done | Create (sidebar), read (sidebar + layout), update (settings form), delete (sidebar menu) |
| 6 | Feed page: URL + text + file | Done | Three tabs, drag-and-drop, compilation trigger, status messages |
| 8 | Compilation engine | Done | Edge function: extract, match, write/update articles, create edges, track stats |
| 9 | Article list + reader | Done | Graph view + wiki view toggle, full typography in reader (660px, 1.65 line-height) |
| 10 | Backlinks sidebar | Done | Queries related_slugs, renders clickable backlink list |
| 11 | Article search (full-text + semantic) | Done | Supabase textSearch with 300ms debounce + semantic search via pgvector embeddings |
| 12 | [[slug]] link rendering | Done | processWikiLinks in ArticleContent, renders as styled internal links |
| 13 | Query with file-back | Done | Ask page, edge function, auto-file answers >300 chars, query history, follow-ups, ?q= auto-submit |
| 14 | Map page | Done | Full-screen route at /[engram]/map, Three.js + d3-force |

### Partial

| # | Feature | Status | What's Missing |
|---|---------|--------|----------------|
| 7 | Parser: URL, text, PDF, DOCX, TXT, MD | Partial | Backend parser supports all formats. FeedPage file upload restricted to TXT/MD. AddSourceButton accepts more formats but reads binary as text (broken). Needs `parse-file` edge function for binary formats. |

### Not Started (Phase 1)

| # | Feature | Notes |
|---|---------|-------|
| — | FastAPI + docker-compose | Architecture decision: using Supabase edge functions instead of FastAPI for compilation/query |
| — | Celery workers | Same — async work handled by edge functions |

---

## Phase 2 — Visualizations + Intelligence

### Done

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 2 | Confidence heatmap (voronoi treemap) | Done | VoronoiHeatmap.tsx: d3-voronoi-treemap, fixed 800x200 coordinate system, confidence color gradient, hover tooltips, click-to-article. Shown on Stats page and in Stats widget preview. |
| 3 | Timeline view | Done | TimelineView.tsx: snapshot-driven stratigraphy with colored event nodes, type filters, expandable diffs, restore/rollback. Falls back to legacy events for pre-snapshot engrams. |
| 5 | Compilation pulse (Realtime) | Done | CompilationPulse.tsx subscribes to compilation_runs INSERT/UPDATE, animated gradient sweep |
| 6 | Compilation toast | Done | CompilationToast.tsx shows "X created. Y updated. Z connections found." auto-dismisses 4s |
| 10 | Syntax highlighting | Done | highlight.js with custom engrams dark theme (ochre keywords, sage strings, steel numbers, ghost comments). Language label + copy button on hover. 14 languages registered. |
| 11 | Semantic search (embeddings) | Done | pgvector extension, `embedding vector(1536)` on articles, `generate-embedding` edge function (text-embedding-3-small), `semantic-search` edge function with `match_articles` RPC. ArticleSearch has Text/Semantic toggle. Embeddings auto-generated after compilation. |
| 12 | Engram snapshots | Done | `engram_snapshots` table with RLS, `createSnapshot` utility captures full state (articles/edges/sources) after feed, query fileback, and agent changes. Rollback via timeline. |
| 13 | Knowledge Gaps | Done | KnowledgeGaps.tsx detects missing articles (broken [[slug]] refs), low confidence (<50%), orphans (no edges), thin answers. Actions: Research (auto-submits Ask query), View article, Recompile (triggers compile-source), Ask again. |
| 14 | Expandable widget system | Done | WidgetPanel.tsx: FLIP morph animation from card rect to centered modal (520px, 250ms ease-out). Backdrop dims, preview crossfades to full content. Close reverses. All widgets (Sources, Activity, Stats, Gaps) use this pattern. |

### Partial

| # | Feature | Status | What Works | What's Missing |
|---|---------|--------|------------|----------------|
| 1 | The Map | Partial | Three.js rendering, d3-force layout, hover dimming, signal particles, ripple effects, semantic zoom, position caching, realtime refresh | No edge labels/type visualization, tooltip lacks confidence/metadata, no cluster labels at zoom-out level |
| 7 | Stats dashboard | Partial | Stat boxes (sources, confidence, connections), voronoi confidence heatmap, tag distribution, article type breakdown | Renamed from "Health" to "Stats". Missing staleness indicator, action recommendations |
| 9 | Sources page | Partial | Lists sources with status indicators, reverse provenance (source -> articles map), relative timestamps | No raw content browsing, no filtering/sorting, no re-compile action, no source detail view |

### Not Started

| # | Feature | Notes |
|---|---------|-------|
| 4 | Provenance chain in article sidebar | Article page shows backlinks and source count but no directed graph of source->compilation->article chain |
| 8 | Lint agent | No agent code in web app. Requires backend agent system |

---

## Known Issues & Rough Edges

### Hardcoded Values
- EngineGraph camera Z position: `300 + Math.min(count * 5, 600)` — arbitrary scaling
- Timeline 30-day staleness threshold — not configurable
- Force layout iterations (50 refresh, 300 cold start) — could be adaptive

### Missing Error Handling
- Graph data fetching has no error state display
- Several components assume Supabase responses always succeed
- No retry mechanism for failed compilations

### Design Polish Gaps
- Map tooltip doesn't account for viewport edge clipping
- Sources page has no filtering or sorting
- FeedPage still blocks PDF/DOCX file types

---

## Architecture Notes

### Current Stack (Web)
- **Framework**: Next.js 16 (App Router), React 19, TypeScript strict
- **Styling**: Tailwind CSS 4, custom CSS variables in globals.css
- **Database**: Supabase (Postgres + Auth + Realtime + Storage + pgvector)
- **Compilation**: Supabase edge functions (`compile-source`, `ask-engram`, `semantic-search`, `generate-embedding`)
- **Visualization**: Three.js (graph), d3-force (layout), d3-voronoi-treemap (heatmap), react-markdown + highlight.js (articles)
- **Fonts**: Space Grotesk, DM Sans, JetBrains Mono (Google Fonts)

### Database Tables
- `profiles` — user accounts
- `engrams` — knowledge bases (id, name, slug, accent_color, article_count, source_count, owner_id, visibility, config)
- `articles` — compiled wiki entries (slug, title, summary, content_md, confidence, article_type, tags, source_ids, related_slugs, embedding vector(1536))
- `edges` — relationships (from_slug, to_slug, relation, weight)
- `sources` — raw ingested material (title, source_type, source_url, content_md, status, metadata)
- `compilation_runs` — compilation job tracking (status, articles_created, articles_updated, edges_created)
- `queries` — query history (question, answer_md, articles_consulted, suggested_followups, status)
- `engram_snapshots` — version history (snapshot_number, trigger_type, summary, data jsonb, diff jsonb)

### Edge Functions
- `compile-source` — extracts concepts from source, matches against wiki, writes/updates articles + edges
- `ask-engram` — plans relevant articles, synthesizes answer via GPT-4o-mini, files back substantial answers
- `semantic-search` — embeds query via text-embedding-3-small, cosine similarity search via match_articles RPC
- `generate-embedding` — batch-embeds articles, called after every compilation

### Key Components
```
app/WidgetPanel.tsx        — FLIP morph expand/collapse system for all widgets
app/VoronoiHeatmap.tsx     — d3-voronoi-treemap confidence visualization
app/KnowledgeGaps.tsx      — Gap detection + actionable remediation
app/TimelineView.tsx       — Snapshot-driven stratigraphy with version control
app/ArticleContent.tsx     — Markdown + wiki-links + syntax highlighting
app/ArticleSearch.tsx      — Full-text + semantic search toggle
lib/snapshots.ts           — createSnapshot utility for version history
```

### File Map

#### Pages (apps/web/app/)
```
app/page.tsx                              — Landing page
app/login/page.tsx                        — Email/password + Google login
app/signup/page.tsx                       — Registration + email confirmation
app/auth/callback/route.ts               — OAuth callback handler
app/app/layout.tsx                        — Authenticated app shell (sidebar, topbar)
app/app/page.tsx                          — Engram list / redirect to first engram
app/app/[engram]/page.tsx                 — Main view (graph + wiki toggle + widgets)
app/app/[engram]/map/page.tsx             — Full-screen knowledge graph
app/app/[engram]/ask/page.tsx             — Query interface (?q= auto-submit)
app/app/[engram]/feed/page.tsx            — Source ingestion (URL/text/file)
app/app/[engram]/sources/page.tsx         — Source list with provenance
app/app/[engram]/settings/page.tsx        — Engram configuration
app/app/[engram]/stats/page.tsx           — Analytics dashboard + voronoi heatmap
app/app/[engram]/timeline/page.tsx        — Snapshot-driven activity log
app/app/[engram]/article/[slug]/page.tsx  — Article reader
app/e/[slug]/page.tsx                     — Published engram (public graph)
app/e/[slug]/article/[articleSlug]/page.tsx — Published article (public reader)
app/e/[slug]/layout.tsx                   — Public engram layout
```

---

## What's Next

Priority work to complete Phase 2:

1. **Enable PDF/DOCX upload** — Deploy `parse-file` edge function, update FeedPage to accept binary formats
2. **Build provenance chain** — Directed graph in article sidebar (Phase 2 #4)
3. **Complete sources page** — Content browsing, filtering, re-compile (Phase 2 #9)
4. **Polish the map** — Edge type labels, cluster labels, better tooltips (Phase 2 #1)
5. **Lint agent** — Background agent system (Phase 2 #8)
