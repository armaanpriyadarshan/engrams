# Engrams

A web app (+ desktop + mobile + browser extension) where you create **engrams** — living knowledge organisms. Feed them sources from anywhere, and an LLM compiles them into structured, interlinked wikis that you can browse, query, and visualize. Every query compounds back into the wiki. Background agents tend the engram when you're away.

## Project Structure

```
engrams/
  apps/
    web/          # Next.js 14+ App Router (primary interface)
    desktop/      # Tauri wrapper (native OS features)
    mobile/       # Expo / React Native (share sheet, voice, camera)
    extension/    # Chrome MV3 browser extension
  packages/
    api/          # FastAPI backend (Python)
  supabase/
    migrations/   # Postgres schema
  docs/           # Product documentation (features, vision, design)
```

## Tech Stack

- **Frontend:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Backend:** FastAPI (Python), Celery + Redis (async jobs)
- **Database:** Supabase (Postgres + Auth + Realtime + Storage)
- **LLM:** OpenAI API (GPT-4o for compilation/queries, GPT-4o-mini for lightweight)
- **Visualizations:** Three.js / WebGL (knowledge graph), D3 (heatmaps, timelines)
- **Desktop:** Tauri (Rust)
- **Mobile:** Expo (React Native)
- **Extension:** Chrome MV3

## Product Vocabulary

Use these terms consistently in all code, UI copy, and documentation:

| Term | Meaning |
|---|---|
| engram | A knowledge base |
| forming | Creating an engram |
| feeding | Adding sources |
| compiling | The LLM compilation process |
| asking | Querying an engram |
| tending | Background agent maintenance |
| the map | Knowledge graph visualization |
| article | Individual compiled wiki entry |
| source | Raw ingested material |

## Voice & Tone

Confident, quiet, precise. No exclamation marks. No "Hey there!" No emoji in UI copy. No "Oops!" The word "AI" never appears in the UI. The word "smart" never appears. The intelligence is invisible.

Examples:
- Compilation complete: "4 articles updated. 1 created. 2 connections found."
- Error: "Compilation paused. Source could not be parsed."
- Empty state: "Nothing here yet. Drop a source to begin."
- Destructive: "This will permanently delete the engram and all compiled knowledge. This cannot be undone."

## Design System

Dark monochrome only. No light mode. Typography is the primary design material.

**Colors** (see `docs/design-system.md` for full tokens):
- Ground: `#050505` (void) through `#1A1A1A` (elevated)
- Type: `#3A3A3A` (ghost) through `#FFFFFF` (bright, used sparingly)
- Links: `#888888` to `#F0F0F0` on hover. No blue, ever.
- Semantic accents are muted and used surgically

**Typography:**
- Headings: Space Grotesk (free) / GT Sectra, Canela (licensed targets)
- Body: DM Sans (free) / Sohne, Untitled Sans (licensed targets)
- Mono: JetBrains Mono (free) / Berkeley Mono (licensed target)

**Components:** Sharp geometry (0px radius default, 2px max). Borders over fills. Opacity as depth. Icons: Lucide, stroke 1.5px, monochrome, no filled icons.

## Key Architecture Concepts

- **Compilation engine:** Extract concepts from sources, match against existing wiki, write/update articles, reindex graph, propagate changes to neighbors
- **Query engine:** Plan what articles are relevant, research them, synthesize answer, file back into wiki, suggest follow-ups
- **Background agents:** Compiler, Linter, Freshener, Discoverer, Summarizer, Syncer, Trainer — each runs on schedule via Celery Beat
- **Integrations:** 20+ services (Notion, GitHub, Slack, Google Drive, RSS, etc.) via OAuth + abstract Integration base class
- **Multi-engram:** Private, shared, or published. Cross-engram queries. Forking.

## Testing

Use Playwright MCP tools (`mcp__playwright__*`) to test UI changes against the running dev server at `http://localhost:3000`. Navigate, take snapshots, click elements, and verify behavior visually.

## Development Guidelines

- Every component renders on dark ground. No white backgrounds anywhere, including modals/tooltips/dropdowns.
- Transitions: 120ms hover, 180ms base, 300ms slow, 500ms cinematic (map). All ease-out.
- Empty states use typographic message + generative SVG pattern. No cartoons or illustrations.
- Reader view: 660px max-width, line-height 1.65
- All compilation and agent work runs async via Celery workers
- Row Level Security (RLS) on all Supabase tables — users only access their own data or shared engrams
- Supabase Realtime for live compilation status updates
