# Architecture

## System Overview

```
User Interfaces                    Backend                        Data
-----------------                  -----------------              -----------------
Web (Next.js)    ──┐               FastAPI ──────────────────────> Supabase (Postgres)
Desktop (Tauri)  ──┤── HTTPS ────> Routes                         + Auth
Mobile (Expo)    ──┤               │                              + Realtime
Extension (MV3)  ──┘               ├── Engine (compiler, query)   + Storage
                                   ├── Agents (lint, freshen...)
                                   └── Integrations (OAuth sync)
                                        │
                                   Celery Workers ──> Redis (broker)
                                   Celery Beat (scheduler)
```

## Frontend (Next.js App Router)

### Route Structure

```
(auth)/
  login/             # Authentication
  signup/

(app)/               # Authenticated shell
  [engram]/          # Dynamic per-engram routes
    page             # Article list (reader)
    article/[slug]   # Single article reader
    map/             # Knowledge graph (Three.js)
    ask/             # Query interface
    feed/            # Ingestion interface
    health/          # Stats + confidence heatmap
    sources/         # Raw source browser
    timeline/        # Knowledge stratigraphy
    settings/        # Engram config, integrations, agents, sharing
  settings/          # User settings + integrations
  admin/             # Enterprise admin console
```

### App Shell

- **Sidebar:** Engram switcher (list of engrams with accent dots) + navigation links for active engram
- **TopBar:** Compilation pulse (thin animated line) + breadcrumb
- **Main:** Content area determined by active route

### State & Data

- Supabase client for auth and database queries
- Custom hooks: `useEngram`, `useArticles`, `useGraph`, `useCompilationStatus`, `useQuery`
- `useCompilationStatus` subscribes to Supabase Realtime for live updates on `compilation_runs` table
- Backend API client (`lib/api.ts`) for all FastAPI calls

---

## Backend (FastAPI)

### API Routes

| Prefix | Resource | Key Endpoints |
|---|---|---|
| `/api/engrams` | Engrams | CRUD, fork |
| `/api/engrams/{id}/feed` | Ingestion | URL, text, file, paste, queue |
| `/api/engrams/{id}/compile` | Compilation | Trigger, targeted, deep, lint, status, history |
| `/api/engrams/{id}/ask` | Queries | Ask, history, specific result |
| `/api/engrams/{id}/articles` | Articles | List, read, backlinks, search, annotate |
| `/api/engrams/{id}/graph` | Graph | Full graph, cluster, neighborhood |
| `/api/engrams/{id}/sources` | Sources | List, read, delete (triggers recompile) |
| `/api/engrams/{id}/timeline` | Timeline | Chronological events, filterable |
| `/api/engrams/{id}/health` | Health | Stats, confidence, open questions |
| `/api/engrams/{id}/integrations` | Integrations | Connect, callback, sync, config, available |
| `/api/engrams/{id}/sharing` | Sharing | Members, invite, roles, publish |
| `/api/admin` | Enterprise | Org, members, audit, usage, SSO |

### Engine

- **`engine/compiler.py`** — Core compilation: extract, match, write, reindex, propagate
- **`engine/query_engine.py`** — Query: plan, research, synthesize, file back, suggest
- **`engine/prompts.py`** — All LLM prompts (EXTRACT, WRITE_ARTICLE, update-article system messages). All use `response_format={"type": "json_object"}`
- **`engine/parser.py`** — Format-specific parsers: URL (readability + markdownify), PDF (pymupdf), DOCX, PPTX, XLSX/CSV, images (OCR), audio (Whisper), video (extract audio + Whisper)
- **`engine/tools.py`** — OpenAI function calling tool definitions

### Agents

Each agent is a standalone module in `agents/`:
- `linter.py` — Consistency, gaps, contradictions, staleness, quality
- `freshener.py` — Web search for updates on stale topics
- `discoverer.py` — Gap detection, connection suggestions
- `summarizer.py` — Auto-synthesis for large topic clusters
- `trainer.py` — Synthetic Q&A generation for fine-tuning export

### Async Workers

- **Celery** with Redis broker for all async work (compilation, agent runs, integration syncs)
- **Celery Beat** for scheduled agent runs (lint daily, freshen weekly, discover weekly, sync every 30 min)
- Worker concurrency: 4 (configurable)

### Integrations Framework

Abstract `Integration` base class with two methods:
1. `authenticate(code, redirect_uri)` — Exchange OAuth code for tokens
2. `fetch_sources(credentials, config, since)` — Fetch new sources since last sync

The `sync()` method handles dedup (content hash), source insertion, and compilation triggering. Each service (Notion, GitHub, Slack, etc.) implements the base class with service-specific API calls.

---

## Database (Supabase/Postgres)

### Core Tables

| Table | Purpose |
|---|---|
| `profiles` | User accounts (linked to Supabase Auth) |
| `engrams` | Knowledge bases with config, counts, visibility |
| `engram_members` | Role-based access (owner, editor, viewer) |
| `sources` | Raw ingested material with status tracking |
| `articles` | Compiled wiki entries with confidence, tags, provenance |
| `edges` | Knowledge graph relationships between articles |
| `queries` | Query history with results and follow-ups |
| `compilation_runs` | Compilation job tracking (Realtime-enabled) |
| `integrations` | Connected service configs and encrypted credentials |
| `agent_runs` | Agent execution history (Realtime-enabled) |
| `agent_schedules` | Per-engram agent scheduling config |

### Enterprise Tables

| Table | Purpose |
|---|---|
| `organizations` | Org with SSO config |
| `org_members` | Org membership and roles |
| `audit_log` | Full activity audit trail |

### Key Design Decisions

- **Row Level Security (RLS)** on all tables — users only see their own data, shared engrams they're members of, or published content
- **Supabase Realtime** enabled for `compilation_runs` and `agent_runs` for live UI updates
- **Full-text search** via `tsvector` generated column on articles (title + content)
- **Trigram search** (`pg_trgm`) for fuzzy matching on article titles
- **GIN indexes** on tags array and full-text search columns
- **Content dedup** via `content_hash` on sources
- **Encrypted OAuth tokens** stored in integrations table

### Edge Types

Article relationships tracked in the `edges` table:
- `related` — general connection
- `extends` — builds upon
- `contradicts` — conflicting claims
- `requires` — prerequisite knowledge
- `synthesized_from` — synthesis article derived from source articles

---

## Deployment

| Component | Target |
|---|---|
| Web (Next.js) | Vercel |
| API (FastAPI + Workers) | Railway / Fly.io |
| Database | Supabase (managed Postgres) |
| Redis | Managed Redis (via Railway/Fly.io) |
| Desktop | Tauri builds (Mac/Windows/Linux) |
| Mobile | Expo (App Store / Play Store) |
| Extension | Chrome Web Store |
