"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import ArticleContent from "./ArticleContent"

interface NodeCardProps {
  slug: string
  engramSlug: string
  engramId: string
  onClose: () => void
  linkPrefix?: string
}

interface Article {
  title: string
  summary: string | null
  content_md: string
  confidence: number | null
  article_type: string | null
  tags: string[] | null
}

export default function NodeCard({ slug, engramSlug, engramId, onClose, linkPrefix }: NodeCardProps) {
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Open intentionally docked left-of-center, away from the side widgets and the
  // top-center view toggle. 340px wide, vertically centered-ish.
  const [pos, setPos] = useState(() => {
    if (typeof window === "undefined") return { x: 296, y: 120 }
    const cardWidth = 340
    return {
      x: Math.max(296, Math.round((window.innerWidth - cardWidth) / 2)),
      y: 120,
    }
  })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    supabase
      .from("articles")
      .select("title, summary, content_md, confidence, article_type, tags")
      .eq("engram_id", engramId)
      .eq("slug", slug)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError("Could not load article.")
        else setArticle(data)
        setLoading(false)
      })
  }, [slug, engramId])

  // Drag handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button")) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y }
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      setPos({
        x: dragStart.current.posX + (e.clientX - dragStart.current.x),
        y: dragStart.current.posY + (e.clientY - dragStart.current.y),
      })
    }
    const onUp = () => setDragging(false)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [dragging])

  return (
    <div
      ref={cardRef}
      className="absolute z-30 bg-surface-raised border border-border w-[340px] max-h-[60vh] flex flex-col animate-fade-in"
      style={{ left: pos.x, top: pos.y, cursor: dragging ? "grabbing" : "default" }}
    >
      {/* Header — draggable */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown}
      >
        <span className="text-[10px] font-mono text-text-ghost select-none">article</span>
        <button
          onClick={onClose}
          className="text-text-ghost hover:text-text-secondary transition-colors duration-120 cursor-pointer text-sm font-mono"
        >
          &times;
        </button>
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden px-4 py-4">
        {loading ? (
          <p className="text-xs font-mono text-text-ghost">Loading...</p>
        ) : article ? (
          <>
            <h2 className="font-heading text-lg text-text-emphasis leading-tight">{article.title}</h2>

            {article.summary && (
              <p className="mt-2 text-xs text-text-secondary leading-relaxed">{article.summary}</p>
            )}

            <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-text-ghost">
              {article.article_type && <span>{article.article_type}</span>}
              {article.confidence != null && (
                <>
                  <span>&middot;</span>
                  <span>{(article.confidence * 100).toFixed(0)}%</span>
                </>
              )}
              {article.tags?.map((tag) => <span key={tag}>{tag}</span>)}
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div className="prose-engram leading-[1.6] text-[13px] text-text-primary">
                <ArticleContent contentMd={article.content_md} engramSlug={engramSlug} linkPrefix={linkPrefix} />
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <Link
                href={`${linkPrefix ?? `/app/${engramSlug}`}/article/${slug}`}
                className="text-[10px] font-mono text-text-ghost hover:text-text-emphasis transition-colors duration-120"
              >
                Open full article &rarr;
              </Link>
            </div>
          </>
        ) : (
          <p className="text-xs font-mono text-text-ghost">{error ?? "Article not found."}</p>
        )}
      </div>
    </div>
  )
}
