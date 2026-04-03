# Build Roadmap

## Phase 1 — Core Loop

Foundation. Get the primary cycle working: feed sources, compile a wiki, read articles, ask questions.

1. Next.js skeleton + Supabase project + database migration
2. FastAPI skeleton + docker-compose (Redis + worker)
3. Auth (Supabase): login, signup, session management
4. Design system: globals.css, tailwind.config.ts, fonts, base UI components
5. App shell: sidebar (engram list) + topbar (compilation pulse) + main content area
6. Engram CRUD (backend routes + frontend pages)
7. Feed page: URL input + text paste + file dropzone
8. Parser: URL, text, PDF, DOCX, TXT, MD
9. Compilation engine: extract > match > write > reindex > propagate
10. Celery worker running compilation async
11. Article list page + single article reader with full typography
12. Backlinks sidebar
13. Article search (full-text)
14. `[[slug]]` link rendering in markdown
15. Basic query with file-back
16. **Milestone:** Feed 10+ URLs, browse compiled wiki, ask questions, see knowledge compounding

## Phase 2 — Visualizations + Intelligence

Make the knowledge visible. Add the signature visuals and the first background agent.

1. The Map: Three.js knowledge graph, d3-force layout, hover/click, semantic zoom
2. Confidence heatmap (voronoi treemap)
3. Timeline view (vertical stratigraphy)
4. Provenance chain in article sidebar
5. Compilation pulse (Supabase Realtime)
6. Compilation toast
7. Health dashboard: stats, confidence distribution, open questions
8. Lint agent (daily via Celery Beat)
9. Sources page (browse raw sources, reverse provenance)
10. Output formats: Mermaid diagrams in articles, styled code blocks
11. Semantic search (embeddings — can defer if needed)

## Phase 3 — Multi-Engram + Sharing

Multiple knowledge organisms, working together.

1. Multi-engram support (wire up existing data model to UI)
2. Engram switcher with accent dots
3. Cross-engram queries (select multiple engrams in Ask view)
4. Engram forking
5. Sharing: invite members, roles, permissions
6. Published engrams (public read-only pages with full design system)
7. Engram settings page (config, agent toggles, accent color)
8. User annotations ("wrong" / "expand" / "connect to X") triggering targeted recompile

## Phase 4 — Integrations

Connect to where knowledge already lives.

1. Integration framework (base class, OAuth flow, sync worker)
2. Integration settings UI (connect/disconnect, sync status)
3. **First wave:** GitHub, Notion, Google Drive, RSS, Readwise
4. **Second wave:** Slack, Twitter/X, Reddit, YouTube, Zotero
5. **Third wave:** Linear, Confluence, Pocket, Webhooks
6. Obsidian vault import (bulk file import)
7. Email forwarding setup (per-engram ingest address)

## Phase 5 — Background Intelligence

The engram tends itself.

1. Freshener agent (web search for stale topics)
2. Discoverer agent (gap detection, connection suggestions)
3. Summarizer agent (auto-synthesis for large clusters)
4. Agent schedule UI (enable/disable, frequency per engram)
5. Agent activity feed (in health view)
6. Deep compilation mode (manual trigger for full restructure)

## Phase 6 — Browser Extension + Desktop

Feed from anywhere on your computer.

1. Chrome MV3 extension: popup, context menu, background service worker
2. Extension dark monochrome styling
3. Tauri desktop wrapper
4. Global screenshot hotkey > OCR > feed
5. Menu bar tray with compilation indicator
6. Native file drag > feed
7. Paste anywhere in app > auto-detect and ingest

## Phase 7 — Mobile + Enterprise

Pocket access and organizational scale.

1. Expo app: share sheet target, voice memo, camera OCR
2. Reader tab with offline cache
3. Push notifications for agent suggestions
4. Enterprise: organizations, admin console
5. SSO (SAML/OIDC via Supabase)
6. Audit log
7. Org-level engram management
8. Trainer agent (synthetic Q&A export)

## Phase 8 — Polish + Deploy

Every detail matters.

1. Every empty state has typographic + generative SVG treatment
2. Every transition is smooth (audit all interactive elements)
3. Loading states for all async operations
4. Error states follow voice/tone guidelines
5. Performance: lazy load map, virtualize article lists, optimize Three.js
6. Deploy: Vercel (web), Railway/Fly.io (API + workers), Supabase (DB)
7. Custom domain, SSL
8. Demo engram: feed 30+ sources on a compelling topic
9. Record walkthrough video
10. Launch

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Compilation quality at scale | Hierarchical index + chunked processing. Lint catches drift. Deep compile resets entropy. |
| LLM costs | GPT-4o-mini for lightweight tasks. Incremental compilation. Cache unchanged articles. Usage-based pricing. |
| Context window limits | Index-first navigation. Summaries at every level. Surgical reads. |
| Data loss | Git-backed. Every write is a commit. Revert any agent action. |
| Hallucination | Provenance chain per claim. Confidence scores. Lint cross-checks. User annotation. |
| Integration maintenance | Plugin protocol for community integrations. First-party support for top 10 services only. |
| Design quality drift | Design tokens and components built first (Phase 1). Every feature renders through existing components. No one-off styles. |
