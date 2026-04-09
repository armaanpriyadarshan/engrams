"use client"

// Thin client wrapper that subscribes to recompile_queue and renders the
// UpdatingDot when the reader is looking at an article being rewritten.
// Lives on the server-component article page via a client boundary.

import { useRecompileQueue } from "./useRecompileQueue"
import { UpdatingDot } from "./UpdatingDot"

interface ArticleUpdatingBadgeProps {
  engramId: string
  slug: string
}

export function ArticleUpdatingBadge({ engramId, slug }: ArticleUpdatingBadgeProps) {
  const recompile = useRecompileQueue(engramId)
  const updating = recompile.isUpdating(slug)
  const rewritten = recompile.wasJustRewritten(slug)

  if (!updating && !rewritten) return null

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-text-ghost">·</span>
      <UpdatingDot updating={updating} rewritten={rewritten} verticalAlign="middle" />
    </span>
  )
}
