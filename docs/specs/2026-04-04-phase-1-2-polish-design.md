# Phase 1-2 Polish — Design Spec

Date: 2026-04-04

## Scope

Complete Phase 1-2 of the Engrams web app. Make everything that exists sharp, fill in missing functionality, and add new features that make the knowledge base feel alive and trustworthy.

## Work Items (in order)

### 1. Quick Wins

**1a. Remove placeholders**
- AskBar: Currently shows a fake "Thinking..." response. Wire it to `ask-engram` edge function. On submit from the compact bar, navigate to `/app/[engram]/ask?q={question}` with the question pre-filled and auto-submitted. The Ask page reads the `q` param and triggers the query on mount.
- AgentTimeline: Remove hardcoded placeholder agent runs (lines ~59-63) and fake open questions (lines ~173-175). Show empty state: "No activity yet." in `text-ghost`.
- SourceTree: Remove hardcoded placeholder article counts. Query actual article count per source from the database.

**1b. Rename Health → Stats**
- Rename directory `apps/web/app/app/[engram]/health/` → `apps/web/app/app/[engram]/stats/`
- Update all references: Sidebar nav, breadcrumbs, links in other pages.

**1c. Enable PDF/DOCX upload**
- Change file input `accept` to `.txt,.md,.pdf,.docx,.pptx,.xlsx,.csv`
- Remove "PDF and DOCX support is coming" message
- For PDF/DOCX: read as ArrayBuffer, base64-encode, send to a new edge function `parse-file` that uses the backend parser (PyMuPDF for PDF, python-docx for DOCX)
- Show "Parsing..." status for larger files before compilation begins
- Fallback: if edge function isn't available, show "File parsing requires the backend API" message

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

Widgets that adopt this:
- SourceTree (left)
- AgentTimeline / Timeline (right)
- AskBar (bottom)
- Knowledge Gaps (right, below timeline)

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
- In ArticleContent.tsx, detect code blocks with language annotation, apply highlight.js
- Language label: top-right corner, `text-ghost`, mono, 10px
- Copy button: appears on hover, top-right next to language label, copies code to clipboard

### 4. Voronoi Confidence Heatmap (Stats Page)

Replaces the confidence histogram on the Stats page.

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

Replaces both the timeline page and the AgentTimeline widget.

**Data source:** `engram_snapshots` table (each snapshot = one event on the timeline)

**Visual design:**
- 1px vertical line, `border-emphasis`, left-aligned (not centered)
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
