# Progress

Last updated: 2026-04-04

## Overview

Engrams is in active development. Phase 1 (Core Loop) is ~95% complete. Phase 2 (Visualizations + Intelligence) is ~45% complete. The web app is functional end-to-end: users can create engrams, feed sources, compile articles, browse the knowledge graph, ask questions, and see answers filed back into the wiki.

---

## Phase 1 — Core Loop

### Done

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Next.js skeleton + Supabase project | Done | Next.js 16, React 19, Tailwind 4, Supabase SSR |
| 2 | Auth: login, signup, session management | Done | Email/password, Google OAuth, middleware protection, callback route |
| 3 | Design system: globals.css, fonts, tokens | Done | All color tokens, Space Grotesk/DM Sans/JetBrains Mono, animations, reader width |
| 4 | App shell: sidebar + topbar + main | Done | Collapsible sidebar with engram list, accent dots, create/delete, compilation pulse in topbar |
| 5 | Engram CRUD | Done | Create (sidebar), read (sidebar + layout), update (settings form), delete (sidebar menu) |
| 6 | Feed page: URL + text + file | Done | Three tabs, drag-and-drop, compilation trigger, status messages |
| 8 | Compilation engine | Done | Edge function: extract, match, write/update articles, create edges, track stats |
| 9 | Article list + reader | Done | Graph view + list view toggle, full typography in reader (660px, 1.65 line-height) |
| 10 | Backlinks sidebar | Done | Queries related_slugs, renders clickable backlink list |
| 11 | Article search (full-text) | Done | Supabase textSearch with 300ms debounce, ArticleSearch component |
| 12 | [[slug]] link rendering | Done | processWikiLinks in ArticleContent, renders as styled internal links |
| 13 | Query with file-back | Done | Ask page, edge function, auto-file answers >300 chars, query history, follow-ups |
| 14 | Map page | Done | Full-screen route at /[engram]/map, Three.js + d3-force |

### Partial

| # | Feature | Status | What's Missing |
|---|---------|--------|----------------|
| 7 | Parser: URL, text, PDF, DOCX, TXT, MD | Partial | Backend parser supports all formats. Frontend file upload restricted to TXT/MD only — need to accept PDF, DOCX in the UI and route through backend parser |

### Not Started (Phase 1)

| # | Feature | Notes |
|---|---------|-------|
| — | FastAPI + docker-compose | Architecture decision: using Supabase edge functions instead of FastAPI for compilation/query. Backend API package exists but is not wired into the web app |
| — | Celery workers | Same — async work handled by edge functions |

### Phase 1 Milestone

> Feed 10+ URLs, browse compiled wiki, ask questions, see knowledge compounding.

**Status: Achievable.** The full loop works. Quality depends on edge function compilation output.

---

## Phase 2 — Visualizations + Intelligence

### Done

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 5 | Compilation pulse (Realtime) | Done | CompilationPulse.tsx subscribes to compilation_runs INSERT/UPDATE, animated gradient sweep |
| 6 | Compilation toast | Done | CompilationToast.tsx shows "X created. Y updated. Z connections found." auto-dismisses 4s |

### Partial

| # | Feature | Status | What Works | What's Missing |
|---|---------|--------|------------|----------------|
| 1 | The Map | Partial | Three.js rendering, d3-force layout, hover dimming, signal particles, ripple effects, semantic zoom, position caching, realtime refresh | No edge labels/type visualization, tooltip lacks confidence/metadata, no cluster labels at zoom-out level |
| 3 | Timeline view | Partial | Vertical line with colored dots, three event types (feed/compile/query), chronological sort | Not the "knowledge stratigraphy" vision — needs luminous vertical line, typographic markers, expandable events, diff-style summaries, filtering |
| 7 | Health dashboard | Partial | Stat boxes (articles, sources, confidence, connections), confidence histogram, tag distribution, article type breakdown | No open questions display, no staleness indicator, no action recommendations, minimal polish |
| 9 | Sources page | Partial | Lists sources with status indicators, reverse provenance (source -> articles map), relative timestamps | No raw content browsing, no filtering/sorting, no re-compile action, no source detail view |
| 10 | Output formats | Partial | Markdown rendering via react-markdown, code blocks styled, wiki-links | No Mermaid diagram support, no syntax highlighting, no code block copy button or language labels |

### Not Started

| # | Feature | Notes |
|---|---------|-------|
| 2 | Confidence heatmap (voronoi treemap) | No heatmap visualization exists. Health page has a basic histogram only |
| 4 | Provenance chain in article sidebar | Article page shows backlinks and source count but no directed graph of source->compilation->article chain |
| 8 | Lint agent | No agent code in web app. AgentTimeline shows placeholder data. Requires backend agent system |
| 11 | Semantic search (embeddings) | No embedding integration. Full-text search only via Supabase tsvector |

---

## Known Issues & Rough Edges

### Placeholder Implementations (need removal or completion)
- **AgentTimeline.tsx**: Shows hardcoded placeholder agent runs (lines 59-63) and open questions (lines 173-176) when no real data exists
- **SourceTree.tsx**: Shows 6 hardcoded transformer papers (lines 58-65) and fake article counts (line 68) when no sources exist
- **FeedPage.tsx**: Shows "PDF and DOCX support is coming" message — frontend blocks file types the backend can handle. Note: AddSourceButton already accepts PDF/DOCX/PPTX in its file input but reads them as text (broken for binary formats)

### Hardcoded Values
- EngineGraph camera Z position: `300 + Math.min(count * 5, 600)` — arbitrary scaling
- Timeline 30-day staleness threshold — not configurable
- SourceTree shows hardcoded placeholder article counts
- Force layout iterations (50 refresh, 300 cold start) — could be adaptive

### Missing Error Handling
- Graph data fetching has no error state display
- Several components assume Supabase responses always succeed
- No retry mechanism for failed compilations

### Design Polish Gaps
- Timeline page has minimal visual hierarchy — far from the "knowledge stratigraphy" vision
- Health page is bare-bones compared to other pages
- Map tooltip doesn't account for viewport edge clipping
- Sources page has no filtering or sorting

---

## Architecture Notes

### Current Stack (Web)
- **Framework**: Next.js 16 (App Router), React 19, TypeScript strict
- **Styling**: Tailwind CSS 4, custom CSS variables in globals.css
- **Database**: Supabase (Postgres + Auth + Realtime + Storage)
- **Compilation**: Supabase edge functions (`compile-source`, `ask-engram`)
- **Visualization**: Three.js (graph), d3-force (layout), react-markdown (articles)
- **Fonts**: Space Grotesk, DM Sans, JetBrains Mono (Google Fonts)

### Database Tables (inferred from queries)
- `profiles` — user accounts
- `engrams` — knowledge bases (id, name, slug, accent_color, article_count, source_count, owner_id, visibility)
- `articles` — compiled wiki entries (slug, title, summary, content_md, confidence, article_type, tags, source_ids, related_slugs)
- `edges` — relationships (from_slug, to_slug, relation, weight)
- `sources` — raw ingested material (title, source_type, source_url, content_md, status, metadata)
- `compilation_runs` — compilation job tracking (status, articles_created, articles_updated, edges_created)
- `queries` — query history (question, answer_md, articles_consulted, suggested_followups, status)

### Backend API (packages/api)
Python FastAPI backend exists with:
- `engine/compiler.py` — compilation logic (extract, match, write, reindex)
- `engine/parser.py` — format parsers (URL via trafilatura, PDF via PyMuPDF, DOCX via python-docx, TXT, MD)
- `routes/compile.py` — compilation route handler

Not currently wired into the web app — edge functions handle compilation instead.

---

## File Map

### Pages (apps/web/app/)
```
app/page.tsx                              — Landing page
app/login/page.tsx                        — Email/password + Google login
app/signup/page.tsx                       — Registration + email confirmation
app/auth/callback/route.ts               — OAuth callback handler
app/app/layout.tsx                        — Authenticated app shell (sidebar, topbar)
app/app/page.tsx                          — Engram list / redirect to first engram
app/app/[engram]/page.tsx                 — Main view (graph + list toggle)
app/app/[engram]/map/page.tsx             — Full-screen knowledge graph
app/app/[engram]/ask/page.tsx             — Query interface
app/app/[engram]/feed/page.tsx            — Source ingestion (URL/text/file)
app/app/[engram]/sources/page.tsx         — Source list with provenance
app/app/[engram]/settings/page.tsx        — Engram configuration
app/app/[engram]/health/page.tsx          — Analytics dashboard
app/app/[engram]/timeline/page.tsx        — Activity log
app/app/[engram]/article/[slug]/page.tsx  — Article reader
app/e/[slug]/page.tsx                     — Published engram (public graph)
app/e/[slug]/article/[articleSlug]/page.tsx — Published article (public reader)
app/e/[slug]/layout.tsx                   — Public engram layout
```

### Components (apps/web/app/components/)
```
app/Sidebar.tsx            — Collapsible left nav, engram switcher, create/delete
app/TopBar.tsx             — Breadcrumb nav + compilation pulse
app/CompilationPulse.tsx   — Animated top bar during compilation (Realtime)
app/CompilationToast.tsx   — Toast notification on compilation complete (Realtime)
app/map/EngineGraph.tsx    — Three.js 3D node/edge visualization
app/map/useGraphData.ts    — Hook: fetch articles + edges, build graph structure
app/map/useForceLayout.ts  — Hook: d3-force layout + position caching
app/NodeCard.tsx           — Slide-in article preview card
app/ArticleContent.tsx     — Markdown renderer with [[slug]] wiki-links
app/ArticleSearch.tsx      — Full-text search with debounce
app/SourceTree.tsx         — Left panel: recent sources with tooltips
app/AskBar.tsx             — Bottom center: quick query input
app/AskPanel.tsx           — Full ask interface
app/AddSourceButton.tsx    — Floating button to add sources
app/AgentTimeline.tsx      — Right panel: agent activity feed
app/ViewToggle.tsx         — Graph/list view toggle
app/SettingsForm.tsx       — Engram settings form
app/FeedPill.tsx           — Feed indicator
app/EngramSelector.tsx     — Engram switching

landing/LandingPage.tsx    — Scroll-driven hero with particle background
landing/KnowledgeGraph.tsx — Demo graph for landing page
landing/graph-data.ts      — Static demo data for landing graph
```

### Lib (apps/web/lib/)
```
supabase/client.ts         — Browser Supabase client
supabase/server.ts         — Server Supabase client (cookie management)
supabase/middleware.ts      — Auth protection for routes
```

---

## What's Next

Priority work to complete Phase 1-2:

1. **Remove placeholders** — AskBar placeholder response, AgentTimeline fake data, SourceTree hardcoded counts
2. **Enable PDF/DOCX upload** — Frontend already blocks these; backend parser handles them
3. **Build confidence heatmap** — Voronoi treemap visualization (Phase 2 #2)
4. **Build provenance chain** — Directed graph in article sidebar (Phase 2 #4)
5. **Polish timeline** — Upgrade to knowledge stratigraphy vision (Phase 2 #3)
6. **Polish health dashboard** — Add open questions, staleness, action items (Phase 2 #7)
7. **Add Mermaid + syntax highlighting** — Code block rendering (Phase 2 #10)
8. **Complete sources page** — Content browsing, filtering, re-compile (Phase 2 #9)
9. **Polish the map** — Edge type labels, cluster labels, better tooltips (Phase 2 #1)
10. **Semantic search** — Embedding integration (Phase 2 #11, deferred if needed)
