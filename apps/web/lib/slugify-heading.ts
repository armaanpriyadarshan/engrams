// Deterministic heading → anchor id slugification.
//
// Both ArticleContent (which renders h2/h3 with id attributes) and
// ArticleToc (which renders the sidebar links) use this function so
// the two agree on the exact id string. Pure function, no external
// state.
//
// The algorithm is standard: lowercase, replace non-alphanumeric runs
// with a single hyphen, trim leading/trailing hyphens. Collisions
// within a single article are resolved by appending "-2", "-3", etc.
// via slugifyHeadings which tracks seen ids.

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

/**
 * Slugify a sequence of heading texts, resolving collisions by
 * appending -2, -3, etc. to duplicates in order of appearance.
 */
export function slugifyHeadings(texts: string[]): string[] {
  const seen = new Map<string, number>()
  return texts.map((t) => {
    const base = slugifyHeading(t) || "section"
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  })
}

/**
 * Parse a markdown string and return an ordered list of h2/h3
 * headings with pre-computed ids. Handles fenced code blocks (```)
 * by skipping their contents so `## foo` inside a code block doesn't
 * become a TOC entry.
 *
 * Returns ids that collide-resolved the same way slugifyHeadings
 * does, so a second call from the rendering side will produce
 * identical ids as long as both see the same markdown.
 */
export interface ParsedHeading {
  level: 2 | 3
  text: string
  id: string
}

export function parseHeadings(markdown: string): ParsedHeading[] {
  const lines = markdown.split("\n")
  let inFence = false
  const raw: { level: 2 | 3; text: string }[] = []

  for (const line of lines) {
    // Track fenced code blocks so code examples starting with ## don't
    // become headings.
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const m2 = line.match(/^##\s+(.+?)\s*$/)
    if (m2) {
      raw.push({ level: 2, text: m2[1].trim() })
      continue
    }
    const m3 = line.match(/^###\s+(.+?)\s*$/)
    if (m3) {
      raw.push({ level: 3, text: m3[1].trim() })
    }
  }

  const ids = slugifyHeadings(raw.map((r) => r.text))
  return raw.map((r, i) => ({ level: r.level, text: r.text, id: ids[i] }))
}
