// Hardcoded default guidance blocks for compile-source prompts.
//
// These MUST stay in sync with the DEFAULT_SUMMARIZE_GUIDANCE and
// DEFAULT_WRITE_GUIDANCE constants inside
// supabase/functions/compile-source/index.ts. The edge function can't
// be imported into the Next.js app (different runtime), so the two
// copies are maintained manually. The comment block at the top of
// compile-source says so too.
//
// The Settings > Prompts UI uses these as:
//   (a) placeholder text when no override exists
//   (b) the fallback view shown as "Default" mode
//
// Users can override either template per engram; the edge function
// swaps in the user's body when an active prompt_templates row exists.

export const TEMPLATE_NAMES = ["summarize_source", "write_concept"] as const
export type TemplateName = (typeof TEMPLATE_NAMES)[number]

export const TEMPLATE_META: Record<
  TemplateName,
  { label: string; description: string }
> = {
  summarize_source: {
    label: "Summarize source",
    description:
      "Pass A — turns a raw source into a durable summary and extracts the concepts worth their own articles.",
  },
  write_concept: {
    label: "Write concept article",
    description:
      "Pass B — writes or rewrites one concept article against the new source summary and any existing article.",
  },
}

export const PROMPT_DEFAULTS: Record<TemplateName, string> = {
  summarize_source: `Your job in this pass is twofold:
1. Produce a dense, encyclopedic summary of the given source — capturing its central claims, definitions, and any unique facts, in markdown. Prefer depth over breadth. 400–800 words is a good target for most sources.
2. Identify the distinct concepts in the source that deserve their own standalone wiki articles. A concept is a named idea, technique, entity, or claim that could be explained without the source in front of you. Typically 1–6 per source.

Rules for the summary:
- Third-person, encyclopedic voice. No first person. No hedging. No filler like "it is important to note".
- Preserve concrete facts, numbers, names, and terminology from the source.
- Do not fabricate.

Rules for the concepts:
- Each concept is a short name (2–4 words typically) plus a one-sentence working definition drawn from the source.
- Concepts should be specific enough to be useful ("Reciprocal Rank Fusion", not "ranking").
- Do not invent concepts that the source does not substantively cover.

Also identify unresolved questions — things this source raises or leaves open. Genuine research questions, not trivial gaps.`,

  write_concept: `You will write or rewrite a single concept article. The input gives you:
- The concept name and a working definition.
- The new summary of a source that mentions this concept (Pass A output).
- The existing article for this concept, if one already exists.
- The wiki index — a flat list of all other article slugs so you can link to them.

Your job:
- Produce a clear, encyclopedic article that explains the concept in its own right, drawing on the new summary and the existing article.
- When an existing article is provided, treat it as the working draft and update it with any new information from the summary. Preserve its voice and any still-accurate claims.
- Use [[slug]] syntax to link to related articles from the wiki index. Only reference slugs that actually appear in the index or in this concept's new slug.
- Third person, encyclopedic. No first person. No hedging. No filler.
- Assign confidence 0.0–1.0 based on how well the sources support the claims.
- Tags are lowercase, 1–2 words each, 2–5 total.
- article_type should be "concept" unless the article explicitly synthesizes across many topics (then "synthesis").`,
}
