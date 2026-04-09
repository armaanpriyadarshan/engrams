// Canonical article-type taxonomy.
//
// Shared by: the article reader pill, the wiki view section headings,
// the knowledge-graph node shader, and compile-source prompt defaults
// (mirrored in apps/web/lib/prompt-defaults.ts and in the edge function
// DEFAULT_WRITE_GUIDANCE constant).
//
// Changes here must land in three places at once if you touch more than
// the color palette:
//   1. This file — display metadata
//   2. supabase/functions/compile-source/index.ts — DEFAULT_WRITE_GUIDANCE
//   3. apps/web/lib/prompt-defaults.ts — mirrored default
// …plus the articles_article_type_check migration in the DB if you
// add or remove type values.

export const ARTICLE_TYPES = [
  "concept",
  "technique",
  "claim",
  "artifact",
  "synthesis",
  "index",
  "query-result",
  "summary",
] as const

export type ArticleType = (typeof ARTICLE_TYPES)[number]

export interface ArticleTypeMeta {
  /** The canonical value stored in articles.article_type. */
  id: ArticleType
  /** Display label used in the reader pill and wiki section heading. */
  label: string
  /** One-line description for tooltips and Pass B guidance. */
  description: string
  /**
   * Token reference from globals.css. Use as a CSS var string in
   * style attributes (e.g. `color: var(--color-confidence-high)`),
   * not as a hex literal — keeps the palette consistent if tokens shift.
   */
  colorVar: string
  /**
   * Hex fallback for surfaces that can't resolve CSS variables
   * (e.g. the WebGL shader in EngineGraph). Must match the value of
   * colorVar in globals.css.
   */
  colorHex: string
  /**
   * When true, this type is treated as internal plumbing: hidden from
   * the wiki sections list, the knowledge graph, and hybrid search.
   * Used for summary rows from Pass A.
   */
  hidden?: boolean
}

export const ARTICLE_TYPE_META: Record<ArticleType, ArticleTypeMeta> = {
  concept: {
    id: "concept",
    label: "concept",
    description: "A named idea, definition, or theory.",
    colorVar: "var(--color-text-primary)",
    colorHex: "#D0D0D0",
  },
  technique: {
    id: "technique",
    label: "technique",
    description: "A method, procedure, or how-to.",
    colorVar: "var(--color-confidence-high)",
    colorHex: "#7A8F76",
  },
  claim: {
    id: "claim",
    label: "claim",
    description: "A falsifiable assertion with supporting evidence.",
    colorVar: "var(--color-confidence-mid)",
    colorHex: "#8F8A76",
  },
  artifact: {
    id: "artifact",
    label: "artifact",
    description: "A file, document, or external reference the wiki cites.",
    colorVar: "var(--color-text-tertiary)",
    colorHex: "#555555",
  },
  synthesis: {
    id: "synthesis",
    label: "synthesis",
    description: "A multi-concept tie-together article.",
    colorVar: "var(--color-agent-active)",
    colorHex: "#76808F",
  },
  index: {
    id: "index",
    label: "index",
    description: "A structural hub — table of contents over related articles.",
    colorVar: "var(--color-text-secondary)",
    colorHex: "#888888",
  },
  "query-result": {
    id: "query-result",
    label: "query result",
    description: "An article filed back from a user question.",
    colorVar: "var(--color-stale)",
    colorHex: "#8F8676",
  },
  summary: {
    id: "summary",
    label: "summary",
    description: "Pass A intermediate artifact. Internal plumbing.",
    colorVar: "var(--color-text-ghost)",
    colorHex: "#3A3A3A",
    hidden: true,
  },
}

export function getArticleTypeMeta(type: string | null | undefined): ArticleTypeMeta {
  if (!type) return ARTICLE_TYPE_META.concept
  const lookup = ARTICLE_TYPE_META[type as ArticleType]
  if (lookup) return lookup
  // Unknown legacy type → render as concept rather than blowing up.
  return ARTICLE_TYPE_META.concept
}

/** Format a type id for a section heading: "query-result" → "Query results". */
export function formatArticleTypeHeading(type: string): string {
  const meta = getArticleTypeMeta(type)
  const label = meta.label
  return label.charAt(0).toUpperCase() + label.slice(1) + "s"
}

/** Visible types only — excludes internal plumbing like summary. */
export const VISIBLE_ARTICLE_TYPES: ArticleType[] = ARTICLE_TYPES.filter(
  (t) => !ARTICLE_TYPE_META[t].hidden,
)
