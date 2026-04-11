// Composite engram health score — derived from observable signals only,
// never from LLM self-assessment. The "Confidence" stat it replaces was
// the average of article.confidence, a number the compiler LLM assigns
// with almost no calibration (GPT-4o-mini picks from {0.85, 0.9, 0.95}
// for nearly everything, so every engram lands at ~87%).
//
// This score is computed from seven independent penalties that each
// correspond to something the user could in principle notice and act on:
//
//   - Staleness       — % articles untouched in the last 30 days
//   - Shallow content — % articles under 100 words
//   - Single source   — % articles backed by ≤1 source
//   - Unembedded      — % articles missing an embedding
//   - Connection density — edges per article (target: 1.5+)
//   - Gap pressure    — open knowledge_gaps per article (capped)
//   - Lint errors     — open error-severity lint findings
//
// Each penalty is bounded so no single dimension can dominate the score.
// The breakdown array is returned alongside the numeric score so the UI
// can show the user exactly what's dragging the number down.

export interface EngramHealthArticleInput {
  content_md: string | null
  updated_at: string
  source_ids: string[] | null
}

export interface EngramHealthInput {
  articles: EngramHealthArticleInput[]
  edges_count: number
  unembedded_count: number
  open_gaps: number
  open_lint_errors: number
}

export interface EngramHealthPenalty {
  id: string
  label: string
  penalty: number // negative number, e.g. -12
  detail: string
}

export interface EngramHealthResult {
  score: number // 0-100, integer
  grade: "excellent" | "good" | "fair" | "poor" | "critical"
  breakdown: EngramHealthPenalty[]
}

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000
const SHALLOW_WORD_THRESHOLD = 100
const TARGET_EDGE_DENSITY = 1.5 // edges per article

export function computeEngramHealth(input: EngramHealthInput): EngramHealthResult {
  const { articles, edges_count, unembedded_count, open_gaps, open_lint_errors } = input
  const n = articles.length

  if (n === 0) {
    return {
      score: 0,
      grade: "critical",
      breakdown: [
        {
          id: "empty",
          label: "No articles",
          penalty: -100,
          detail: "Feed a source to start building this engram.",
        },
      ],
    }
  }

  const now = Date.now()
  const breakdown: EngramHealthPenalty[] = []
  let total = 100

  // Staleness — up to -15
  const staleCount = articles.filter(
    (a) => now - new Date(a.updated_at).getTime() > STALE_THRESHOLD_MS,
  ).length
  const stalePct = staleCount / n
  const stalePenalty = Math.round(stalePct * 15)
  if (stalePenalty > 0) {
    breakdown.push({
      id: "staleness",
      label: "Stale articles",
      penalty: -stalePenalty,
      detail: `${staleCount}/${n} articles (${Math.round(stalePct * 100)}%) not updated in 30 days.`,
    })
    total -= stalePenalty
  }

  // Shallow content — up to -15
  const shallowCount = articles.filter((a) => {
    const wc = (a.content_md ?? "").split(/\s+/).filter(Boolean).length
    return wc < SHALLOW_WORD_THRESHOLD
  }).length
  const shallowPct = shallowCount / n
  const shallowPenalty = Math.round(shallowPct * 15)
  if (shallowPenalty > 0) {
    breakdown.push({
      id: "shallow",
      label: "Thin articles",
      penalty: -shallowPenalty,
      detail: `${shallowCount}/${n} articles (${Math.round(shallowPct * 100)}%) under ${SHALLOW_WORD_THRESHOLD} words.`,
    })
    total -= shallowPenalty
  }

  // Single-source — up to -15
  const singleSourceCount = articles.filter(
    (a) => (a.source_ids ?? []).length <= 1,
  ).length
  const singlePct = singleSourceCount / n
  const singlePenalty = Math.round(singlePct * 15)
  if (singlePenalty > 0) {
    breakdown.push({
      id: "single_source",
      label: "Single-source articles",
      penalty: -singlePenalty,
      detail: `${singleSourceCount}/${n} articles (${Math.round(singlePct * 100)}%) backed by one or fewer sources.`,
    })
    total -= singlePenalty
  }

  // Unembedded — up to -10
  const unembeddedPct = unembedded_count / n
  const unembedPenalty = Math.round(unembeddedPct * 10)
  if (unembedPenalty > 0) {
    breakdown.push({
      id: "unembedded",
      label: "Missing embeddings",
      penalty: -unembedPenalty,
      detail: `${unembedded_count}/${n} articles (${Math.round(unembeddedPct * 100)}%) lack embeddings. Semantic search falls back to BM25 for these.`,
    })
    total -= unembedPenalty
  }

  // Connection density — up to -15
  const density = edges_count / n
  if (density < TARGET_EDGE_DENSITY) {
    const densityPenalty = Math.round(((TARGET_EDGE_DENSITY - density) / TARGET_EDGE_DENSITY) * 15)
    if (densityPenalty > 0) {
      breakdown.push({
        id: "connections",
        label: "Low interconnection",
        penalty: -densityPenalty,
        detail: `${edges_count} edges across ${n} articles (${density.toFixed(2)} per article). Target: ${TARGET_EDGE_DENSITY}+.`,
      })
      total -= densityPenalty
    }
  }

  // Gap pressure — up to -15 (capped at 1 gap/article)
  const gapPressure = Math.min(open_gaps / n, 1)
  const gapPenalty = Math.round(gapPressure * 15)
  if (gapPenalty > 0) {
    breakdown.push({
      id: "gaps",
      label: "Open knowledge gaps",
      penalty: -gapPenalty,
      detail: `${open_gaps} open gap${open_gaps === 1 ? "" : "s"} across ${n} articles.`,
    })
    total -= gapPenalty
  }

  // Lint errors — up to -10 (2 per error, capped)
  if (open_lint_errors > 0) {
    const lintPenalty = Math.min(open_lint_errors * 2, 10)
    breakdown.push({
      id: "lint",
      label: "Open lint errors",
      penalty: -lintPenalty,
      detail: `${open_lint_errors} error-severity finding${open_lint_errors === 1 ? "" : "s"}.`,
    })
    total -= lintPenalty
  }

  const score = Math.max(0, Math.round(total))
  const grade: EngramHealthResult["grade"] =
    score >= 90 ? "excellent" :
    score >= 75 ? "good" :
    score >= 60 ? "fair" :
    score >= 40 ? "poor" : "critical"

  return { score, grade, breakdown }
}
