# Features

## Core Loop

### Engram Management
- Create, rename, configure, and delete engrams
- Each engram has a name, slug, description, and user-chosen accent color
- Configurable compilation rules, persona, and agent policies per engram
- Fork published engrams as your own private copy

### Feeding (Ingestion)
Feed sources into an engram from anywhere, in any format:

- **URL:** Paste or type a URL. Readability extraction + markdown conversion.
- **Text:** Paste raw text directly.
- **File upload:** Drag-and-drop or file picker. Supports PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, images, audio, video.
- **Clipboard paste:** Cmd+V anywhere in the app. Auto-detects URL vs text vs image.
- **Global drop target:** The entire app viewport is a drop zone.

Processing pipeline for all sources:
1. Detect format (MIME type + heuristics)
2. Parse to markdown (format-specific parsers)
3. Deduplicate (content hash + optional embedding similarity)
4. Enqueue for compilation

### Compilation
The LLM incrementally maintains a structured wiki from raw sources:

- **Incremental:** New source fed — process against existing wiki
- **Targeted:** User flags an article — recompile specific articles + neighbors
- **Deep:** User-triggered or scheduled — full restructure, merge, split, re-link, re-index
- **Lint:** Scheduled daily — consistency checks, gap detection, staleness

Compilation steps: Extract concepts from source, match against existing wiki, write/update articles, reindex graph and search, propagate changes to neighboring articles (depth-limited).

### Reading
- Browse compiled articles with full typographic treatment
- Articles display confidence score, tags, sources, related concepts, and last updated
- `[[slug]]` links rendered as interlinked wiki navigation
- Backlinks sidebar showing all articles that reference the current one
- Provenance chain: small directed graph showing how the article was constructed from sources
- Full-text search across all articles
- Filter by article type (concept, synthesis, index, query result), tags, or confidence

### Asking (Queries)
- Natural language questions against one or more engrams
- Query engine: plan what's relevant, research articles, synthesize answer, file back, suggest follow-ups
- Results render with full typographic fidelity (not chat bubbles)
- One-click file-back: save substantial answers as new wiki articles
- Suggested follow-up questions generated from research
- Gaps discovered during queries get flagged
- Query history browsable

### User Annotations
- Highlight text in an article and annotate: "Wrong" / "Expand" / "Connect to X"
- Annotations trigger targeted recompilation of the article and its neighbors

---

## Visualizations

### The Map (Knowledge Graph)
The signature visual. A knowledge constellation rendered on the void via WebGL (Three.js):

- Nodes sized by article depth (word count x source count), rendered with radial gradient glow
- Edges as thin curved arcs, variable opacity based on connection strength, faint 1px gaussian blur glow
- Clusters emerge organically via community detection, tinted with desaturated semantic accents
- Hover: node + neighbors illuminate, everything else fades to 8% over 400ms
- Semantic zoom: zoomed out = cluster labels, zoomed in = individual nodes, deepest = article titles
- Idle animation: glacial organic drift
- New nodes fade in over 1 second when compilation adds articles
- Layout computed via d3-force, rendered via Three.js/WebGL

### Confidence Heatmap
- Voronoi treemap of all articles
- Cell size = word count, fill color = confidence on muted accent scale
- Low-confidence cells glow warm, high-confidence cells are cool/neutral
- Interactive: hover for title + confidence, click to open article

### Timeline (Knowledge Stratigraphy)
- Vertical timeline showing the engram's evolution
- Events: feeds, compilations, queries, agent actions
- Thin luminous vertical line with typographic event markers
- Expandable events showing diff-style summaries
- Filterable by event type and date range

### Provenance Chain
- Small directed graph in the article sidebar
- Shows: which sources fed the article, which compilation passes touched it, which queries enriched it
- Thin luminous lines, circuit-diagram aesthetic

### Compilation Pulse
- 2px horizontal line at the very top of the viewport
- Animates with a slow breathing luminance sweep when agents are working
- Not a progress bar or spinner — an ambient pulse
- On completion: brief brighten + typographic toast ("4 articles updated. 1 created. 2 connections found.") that fades after 4 seconds
- Driven by Supabase Realtime subscription to `compilation_runs` table

---

## Background Agents

Async workers that tend the engram on schedule or trigger. Each engram has configurable agent policies.

| Agent | Schedule | Function |
|---|---|---|
| **Compiler** | On feed | Incremental compilation of new sources |
| **Linter** | Daily (3am) | Consistency, gaps, redundancy, quality checks, contradiction detection |
| **Freshener** | Weekly (Monday 4am) | Web search for updates on stale topics, re-feed if new info found |
| **Discoverer** | Weekly (Thursday 4am) | Analyze map for underexplored connections, suggest new articles, find related sources |
| **Summarizer** | On threshold | When a topic cluster exceeds N articles, auto-generate synthesis article |
| **Syncer** | Every 30 min | Pull new data from connected service integrations |
| **Trainer** | On demand | Generate synthetic Q&A pairs from wiki for fine-tuning export |

Linter checks:
- **Orphans:** Articles with no edges — suggest connections or merge candidates
- **Gaps:** Concepts referenced but never defined, thin coverage areas
- **Redundancy:** Near-duplicate articles — suggest merges
- **Staleness:** Articles whose sources are old or topics are fast-moving
- **Low confidence:** Articles below threshold — queue for enrichment
- **Contradictions:** Cross-reference claims across articles for conflicts

All agent actions are logged with full provenance and are git-backed — any action can be reviewed and reverted.

---

## Integrations

### Native Ingestion Channels

| Channel | Mechanism | Friction |
|---|---|---|
| Browser extension | One-click clip any URL. Right-click selected text to feed. | 1 click |
| Drag and drop | Drop files onto the app viewport | 0 clicks |
| Paste | Cmd+V anywhere — URLs, text, images auto-detected | 1 keystroke |
| Mobile share sheet | Share from any app to "Feed to Engrams" | 2 taps |
| Email forwarding | `{slug}@feed.engrams.app` — forward newsletters, threads, attachments | 1 forward |
| API endpoint | `POST /api/engrams/{id}/feed` | Programmatic |
| CLI | `engrams feed <file_or_url> --engram <name>` | 1 command |
| Screenshot | Global hotkey (desktop) — capture region, OCR, ingest | 1 hotkey |
| Voice memo | Mobile app — hold button, speak, Whisper transcription | 1 hold |
| Bookmarklet | For browsers without extension support | 1 click |

### Service Integrations (20+)

All operate in two modes: **one-time import** and **continuous sync**.

| Service | What Gets Fed |
|---|---|
| **Notion** | Pages as markdown, database rows as structured articles |
| **Obsidian** | .md files with frontmatter preserved |
| **Google Drive** | Docs, Sheets (CSV), Slides (text + images), PDFs |
| **GitHub / GitLab** | README, docs, wiki, issues, PRs as markdown |
| **Slack** | Message threads matching keywords/reactions |
| **Twitter/X** | Bookmarked tweets and threads |
| **Reddit** | Saved posts + top comments |
| **YouTube** | Transcripts (Whisper or YouTube captions) + metadata |
| **RSS** | New articles from subscribed feeds |
| **Pocket / Instapaper / Raindrop** | Saved articles as markdown |
| **Readwise / Reader** | Highlights grouped by source |
| **Zotero / Mendeley** | PDFs + annotations + metadata |
| **Linear / Jira / Asana** | Issues and comments as structured sources |
| **Confluence** | Pages as markdown |
| **Airtable** | Rows as structured data |
| **Discord** | Pinned messages or bot-tagged content |
| **Kindle Highlights** | Highlights grouped by book (via Readwise) |
| **Webhooks** | Arbitrary JSON/text payloads |
| **Zapier / Make / n8n** | Any workflow output via API |

Integration UX: Settings > Integrations > Connect > OAuth flow > Select what to sync > Choose target engram > Done. Each integration shows sync status, last sync time, and source count.

---

## Multi-Engram

### Engram Types

| Type | Visibility | Use Case |
|---|---|---|
| Private | Owner only | Personal research, notes |
| Shared | Invited members (role-based) | Team knowledge, project wikis |
| Published | Public read, owner write | Public knowledge bases, courses |

### Cross-Engram Queries
Select multiple engrams when asking a question. The query engine reads indexes from all selected engrams, identifies overlapping concepts, reads relevant articles from each, and synthesizes a cross-engram answer. Results can be filed into any target engram.

### Engram Switcher
Left sidebar. Each engram shows name + 3px accent dot. Active engram determines the content area. Switching is instant — the dark canvas stays constant, only content and accent change.

### Forking
Clone a published engram as your own private copy and evolve independently.

### Sharing
Invite members by email with role-based access (owner, editor, viewer). Published engrams render as read-only pages using the full design system. Viewers can fork published engrams.

---

## Health Dashboard

The engram's MRI. Shows at a glance:
- Article count, source count, average confidence
- Staleness distribution
- Tag distribution
- Confidence heatmap (voronoi)
- Open questions (gaps the linter found)
- Recent agent activity log

---

## Query Output Formats

| Format | Use Case |
|---|---|
| Article | Default — full reader typography |
| Marp slides | Presentations — dark ground, heading typeface, minimal |
| Mermaid diagrams | Architecture, flows — Engrams color system on void |
| Charts (Plotly/Recharts) | Data analysis — monochrome-first |
| Report (PDF) | Deliverables — Engrams fonts |
| Table | Comparisons — data typeface, sortable, minimal grid |

---

## Platform-Specific Features

### Browser Extension (Chrome MV3)
- One-click clip current page as markdown + images
- Right-click selected text to feed with engram picker
- Highlight + annotate before feeding
- Auto-detect if URL was previously fed (dedup indicator)
- Dark monochrome popup matching app design

### Desktop App (Tauri)
- Global hotkey for screenshot region > OCR > feed to active engram
- Menu bar tray icon with compilation pulse color
- Native file drag from Finder/Explorer > feed
- Offline mode: cache compiled wiki locally, sync on reconnect
- Deep links: `engrams://article/slug`

### Mobile App (Expo)
- Share sheet integration (primary mobile use case)
- Voice memo: hold to record > Whisper transcription > feed
- Camera: capture > OCR > feed (whiteboards, book pages, receipts)
- Reader tab with offline cached articles
- Push notifications for agent suggestions ("Your engram has thin coverage on X. Research?")

---

## Enterprise

| Feature | Description |
|---|---|
| Team engrams | Shared engrams with roles (owner, editor, viewer) |
| SSO | SAML/OIDC via Supabase Auth |
| Audit log | Every agent action, query, and edit logged |
| Compliance export | Full engram as markdown + git history |
| Admin console | Manage engrams, users, agent policies, usage |
| API access | Programmatic CRUD, feed, query |
| Custom LLM | BYOM (Azure OpenAI, self-hosted, fine-tuned) |
| Knowledge continuity | Offboarded user's engram persists, team-owned |
| Cross-engram permissions | Query across team engrams with access controls |
| Integration management | Admin controls which integrations are allowed |
