# Phase 1-2 Polish — Design Spec

Date: 2026-04-04
Updated: 2026-04-04 (post-audit)

## Scope

Complete Phase 1-2 of the Engrams web app. Make everything that exists sharp, fill in missing functionality, and add new features that make the knowledge base feel alive and trustworthy.

## Current State (audited)

What's real:
- AskBar: Fully wired to `ask-engram` edge function. Shows answer, articles consulted, follow-ups. No placeholder.
- ArticleSearch: Working full-text search via Supabase `textSearch` with 300ms debounce. Component exists at `ArticleSearch.tsx`.
- AddSourceButton: Accepts `.pdf,.md,.txt,.csv,.json,.docx,.pptx` in the file input. But reads all files as `file.text()` — binary formats (PDF/DOCX) will produce garbage.
- All core flows (feed, compile, ask, graph, wiki, settings) are real and database-connected.

What's placeholder/incomplete:
- AgentTimeline: Lines 59-63 show hardcoded fallback runs when `runs.length === 0`. Lines 173-176 show hardcoded open questions when none exist.
- SourceTree: Lines 58-65 show 6 hardcoded transformer papers when `sources.length === 0`. Line 68 maps placeholder IDs to fake article counts.
- FeedPage: Lines 79-80 still block PDF/DOCX with message "PDF and DOCX support is coming." File input accepts only `.txt,.md` (line 182). Inconsistent with AddSourceButton.
- Health page: Still at `/health/`, titled "Health". No `/stats/` route exists.
- No syntax highlighting in code blocks (plain monospace).
- No expandable widget system (each panel has standalone expand logic).
- No snapshots, no voronoi heatmap, no knowledge gaps, no semantic search.

## Work Items (in order)

### 1. Quick Wins

**1a. Remove placeholder fallbacks**
- AgentTimeline (`AgentTimeline.tsx`):
  - Remove lines 59-63 (hardcoded compiler/linter/feed placeholder runs)
  - Remove lines 173-176 (hardcoded open questions)
  - When `runs.length === 0`, show: "No activity yet." in `text-ghost`
  - When no open questions, hide the "Open questions" section entirely
- SourceTree (`SourceTree.tsx`):
  - Remove lines 58-65 (hardcoded transformer paper list)
  - Remove line 68 (placeholder article count map)
  - When `sources.length === 0`, show: "No sources yet." in `text-ghost`

**1b. Rename Health → Stats**
- Rename directory `apps/web/app/app/[engram]/health/` → `apps/web/app/app/[engram]/stats/`
- Update page heading from "Health" to "Stats"
- Update all references: Sidebar nav, breadcrumbs, links in other pages

**1c. Reconcile file upload across Feed page and AddSourceButton**
- FeedPage (`feed/page.tsx`):
  - Update `handleFile` (line 77-92) to accept all formats, not just TXT/MD
  - Update file input `accept` (line 182) to `.txt,.md,.pdf,.docx,.pptx,.xlsx,.csv`
  - Remove "PDF and DOCX support is coming" message (line 80)
  - Remove "Supports TXT, MD. More formats coming." text (line 190)
- Both FeedPage and AddSourceButton:
  - For binary formats (PDF, DOCX, PPTX, XLSX): read as ArrayBuffer, base64-encode, send to a new edge function `parse-file` that uses the backend parser (PyMuPDF for PDF, python-docx for DOCX)
  - Show "Parsing..." status for larger files before compilation begins
  - Fallback: if edge function is unavailable, show "File parsing requires the backend API."

### 2. Expandable Widget Pattern

**Component: `ExpandableWidget`**

Props:
```typescript
interface ExpandableWidgetProps {
  id: string                    // unique key for mutual exclusion
  position: 'left' | 'right' | 'bottom'
  preview: React.ReactNode      // compact content
  children: React.ReactNode     // expanded content
  previewWidth?: number         // default varies by position
  expandedWidth?: number        // default varies by position
  expandedHeight?: number       // for bottom position
}
```

Behavior:
- Renders preview by default
- Click toggle to expand/collapse
- Only one widget expanded at a time (context provider manages this)
- Escape key collapses
- 180ms ease-out transition on width/height change
- Expanded state: overlay with subtle backdrop blur on edge, no reflow of main content
- Collapsed state: compact preview hugging the edge

Context: `ExpandableWidgetProvider` wraps the engram page, tracks which widget (if any) is expanded via `expandedId` state.

Widgets that adopt this pattern (refactor existing standalone panels):
- SourceTree (left) — currently absolute-positioned with its own state
- AgentTimeline (right) — currently absolute-positioned with its own state
- AskBar (bottom) — currently absolute-positioned with its own state
- Knowledge Gaps (right, below timeline) — new widget

### 3. Syntax Highlighting

- Add `highlight.js` (core + common languages subset)
- Custom theme in `globals.css` using Engrams color tokens:
  - Background: `surface-raised`
  - Keywords: `#8F8A76` (ochre-ish)
  - Strings: `#7A8F76` (sage)
  - Comments: `text-ghost`
  - Numbers: `#76808F` (steel)
  - Functions: `text-emphasis`
  - Default text: `text-primary`
- In ArticleContent.tsx (`code` component, line 67-81):
  - Detect code blocks with language annotation (`className?.includes("language-")`)
  - Apply highlight.js to the block content
- Language label: top-right corner, `text-ghost`, mono, 10px
- Copy button: appears on hover, top-right next to language label, copies code to clipboard

### 4. Voronoi Confidence Heatmap (Stats Page)

Replaces the confidence histogram on the Stats page (currently a basic bar chart at `health/page.tsx` lines 90-109).

- Package: `d3-voronoi-treemap`
- Data: all articles for the engram, grouped as a flat list
- Cell area = word count × source count (depth)
- Cell fill = confidence mapped to gradient: `confidence-low` → `confidence-mid` → `confidence-high`
- Cell border = 1px `border` color
- Hover: cell brightens, tooltip shows title + confidence % + source count
- Click: navigates to `/app/[engram]/article/[slug]`
- Container: full width of stats content area, ~300px height
- Info icon: Lucide `Info` (14px, `text-ghost`) top-right of section header
  - Hover reveals panel (`surface-raised`, `border`, 120ms fade-in):
    "Each cell is an article. Size reflects depth — content length multiplied by source count. Color shows confidence: warm tones indicate lower confidence, cool tones higher."

### 5. Knowledge Gaps Widget

New widget using the expandable pattern, positioned on the right side.

**Gap detection (client-side from existing data):**
1. **Missing articles**: Scan all article `content_md` for `[[slug]]` references where no article with that slug exists
2. **Low confidence**: Articles with confidence < 0.5
3. **Orphans**: Articles with zero edges (no connections)
4. **Thin answers**: Queries where `articles_consulted` was empty or answer_md was < 100 chars

**Preview:** "N gaps found" + most urgent gap title
**Expanded:** Grouped list by gap type, each with:
- Gap description (e.g., "No article for [[quantum-computing]]", "Low confidence: 32%")
- Action button per type:
  - Missing → "Research" (navigates to Ask page with the missing concept as the question)
  - Low confidence → "Strengthen" (navigates to Feed page)
  - Orphan → "Connect" (triggers targeted recompilation via compile-source edge function)
  - Thin answer → "Ask again" (navigates to Ask page with the original question)

### 6. Engram-Level Snapshots

**New Supabase table: `engram_snapshots`**
```sql
create table engram_snapshots (
  id uuid primary key default gen_random_uuid(),
  engram_id uuid references engrams(id) on delete cascade not null,
  snapshot_number integer not null,
  trigger_type text not null check (trigger_type in ('feed', 'query_fileback', 'agent', 'rollback', 'manual')),
  trigger_id uuid,
  summary text not null,
  data jsonb not null,
  diff jsonb not null default '{}',
  created_at timestamptz default now() not null,
  created_by uuid references profiles(id)
);

create index idx_snapshots_engram on engram_snapshots(engram_id, snapshot_number desc);
alter table engram_snapshots enable row level security;
```

**RLS policies:** Same as engrams — owner and members can read, owner can rollback.

**Snapshot creation:** After every user/agent-triggered change:
- Feed page: after successful compilation from a fed source
- Ask page: after a query answer is filed back as a source and compiled
- Agent runs: after an agent modifies articles
- Rollback: after restoring a previous snapshot

The snapshot captures:
- `data`: `{ articles: [...all articles], edges: [...all edges], sources: [...all sources] }`
- `diff`: `{ articles_added: [slugs], articles_updated: [{slug, fields}], articles_removed: [slugs], edges_added: [...], edges_removed: [...] }`

**Rollback:** Read snapshot's `data`, delete all current articles/edges for the engram, insert snapshot's articles/edges, update engram counts, create new snapshot with `trigger_type: 'rollback'`.

### 7. Timeline Redesign — Vertical Stratigraphy + Version Control

Replaces both the timeline page (`timeline/page.tsx` — currently a basic chronological list with 8px dots and no interactivity) and the AgentTimeline widget.

**Data source:** `engram_snapshots` table (each snapshot = one event on the timeline). Depends on item 6.

**Visual design:**
- 1px vertical line, `border-emphasis`, left-aligned (not centered — current implementation already uses left alignment at `left-[72px]`)
- Event nodes: 6px circles on the line, colored by trigger_type:
  - feed: `text-secondary` (#888888)
  - query_fileback: `text-tertiary` (#555555)
  - agent: `agent-active` (#76808F)
  - rollback: `danger` (#8F4040)
  - manual: `text-primary` (#D0D0D0)
- Event content (right of line):
  - Timestamp: mono, `text-ghost`, 10px
  - Summary: `text-secondary`, 13px (e.g., "4 articles updated. 1 created.")
  - Trigger type label: mono, `text-ghost`, 10px, uppercase
- Click to expand: shows full diff
  - Articles added: listed with title, confidence
  - Articles updated: title + changed fields (before/after for content shown as minimal diff — removed in `confidence-low`, added in `confidence-high`)
  - Edges added/removed
- "Now" marker at top with current timestamp

**Version control actions:**
- Each snapshot shows "Restore" button on hover/expand
- Restore confirmation: "This will restore your engram to this point. A snapshot of the current state will be saved first."
- After restore: new rollback snapshot created, page refreshes

**As widget (expandable, right side):**
- Preview: latest event summary + total snapshot count
- Expanded: scrollable stratigraphy, same as full page but constrained height

**As page (`/app/[engram]/timeline`):**
- Full-page layout, no height constraint, all filters visible

**Filters:** Top of timeline, small toggle buttons: All / Feeds / Queries / Agents / Rollbacks

### 8. Semantic Search (OpenAI + pgvector)

Extends the existing ArticleSearch component (`ArticleSearch.tsx`), which already has working full-text search via Supabase `textSearch` with 300ms debounce.

**Database changes:**
```sql
-- Enable pgvector extension
create extension if not exists vector;

-- Add embedding column to articles
alter table articles add column embedding vector(1536);

-- Create index for similarity search
create index idx_articles_embedding on articles using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

**Embedding generation:**
- New edge function `generate-embedding` that takes article content, calls OpenAI `text-embedding-3-small` (1536 dimensions), stores in the `embedding` column
- Called after every article create/update during compilation
- Batch-embeds all articles on first run (backfill)

**Search UI:**
- ArticleSearch component gains a toggle: "Text" / "Semantic"
- Semantic mode: sends query to new edge function `semantic-search` that:
  1. Embeds the query text via OpenAI
  2. Runs `select *, embedding <=> $1 as distance from articles where engram_id = $2 order by distance limit 10`
  3. Returns ranked results with similarity score
- Results show similarity percentage instead of text match highlighting
- Fallback to text search if embedding fails

**Integration with Ask page:**
- Query engine already consults articles — semantic search improves which articles are selected as relevant context

## Dependency Graph

```
1 (Quick Wins) ─── no dependencies, do first
2 (Expandable Widgets) ─── no dependencies, can parallel with 1
3 (Syntax Highlighting) ─── no dependencies, can parallel with 1-2
4 (Voronoi Heatmap) ─── depends on 1b (Stats rename)
5 (Knowledge Gaps) ─── depends on 2 (expandable widget pattern)
6 (Snapshots) ─── no dependencies, can parallel with 1-5
7 (Timeline Redesign) ─── depends on 6 (snapshots) and 2 (expandable widgets)
8 (Semantic Search) ─── no dependencies, can parallel with others
```

Suggested execution order: 1 → 2+3+6 in parallel → 4+5 → 7 → 8

## Design Constraints

All implementations must follow:
- Dark monochrome design system (no white backgrounds, no blue links)
- Typography hierarchy (Space Grotesk headings, DM Sans body, JetBrains Mono code)
- Transitions: 120ms hover, 180ms base, 300ms slow
- Sharp geometry (0px radius default, 2px max)
- Borders over fills, opacity as depth
- Voice: confident, quiet, precise. No exclamation marks. No emoji.
- Icons: Lucide, stroke 1.5px, monochrome

## Documentation

- Update `docs/PROGRESS.md` after each work item is completed
- Add knowledge gaps to `docs/features.md` as a new feature section
