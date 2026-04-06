"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { useRouter } from "next/navigation"

interface Article {
  slug: string
  title: string
  confidence: number
  wordCount: number
  sourceCount: number
}

interface VoronoiHeatmapProps {
  articles: Article[]
  engramSlug: string
}

function confidenceColor(c: number): string {
  if (c < 0.5) {
    const t = c / 0.5
    return `rgb(${Math.round(180 - 30 * t)},${Math.round(90 + 60 * t)},${Math.round(95 - 10 * t)})`
  }
  const t = (c - 0.5) / 0.5
  return `rgb(${Math.round(150 - 60 * t)},${Math.round(150 + 30 * t)},${Math.round(85 + 40 * t)})`
}

export default function VoronoiHeatmap({ articles, engramSlug }: VoronoiHeatmapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; article: Article } | null>(null)
  const [cells, setCells] = useState<{ article: Article; path: string }[]>([])
  // Fixed internal coordinate system — SVG viewBox scales to any container size
  const VW = 600
  const VH = 300
  const computedRef = useRef(false)

  useEffect(() => {
    if (articles.length === 0 || computedRef.current) return
    computedRef.current = true

    async function compute() {
      // @ts-expect-error - d3-voronoi-treemap has no types
      const { voronoiTreemap } = await import("d3-voronoi-treemap")
      // @ts-expect-error - d3-hierarchy import
      const { hierarchy } = await import("d3-hierarchy")

      const root = hierarchy({
        children: articles.map((a) => ({
          ...a,
          value: Math.max(a.wordCount * Math.max(a.sourceCount, 1), 100),
        })),
      }).sum((d: { value?: number }) => d.value ?? 0)

      const treemap = voronoiTreemap().clip([
        [0, 0], [VW, 0], [VW, VH], [0, VH],
      ])

      treemap(root)

      const result: { article: Article; path: string }[] = []
      for (const leaf of root.leaves()) {
        const polygon = leaf.polygon
        if (!polygon || polygon.length < 3) continue
        const path = "M" + polygon.map((p: number[]) => `${p[0]},${p[1]}`).join("L") + "Z"
        result.push({ article: leaf.data as Article, path })
      }
      setCells(result)
    }

    compute()
  }, [articles])

  const [infoVisible, setInfoVisible] = useState(false)

  if (articles.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono">Confidence map</h2>
        <div className="relative">
          <button
            onMouseEnter={() => setInfoVisible(true)}
            onMouseLeave={() => setInfoVisible(false)}
            className="text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
          {infoVisible && (
            <div className="absolute right-0 top-6 z-10 w-64 bg-surface-raised border border-border p-3 text-[11px] text-text-secondary leading-relaxed" style={{ animation: "fade-in-only 120ms ease-out both" }}>
              Each cell is an article. Size reflects depth — content length multiplied by source count. Color shows confidence: warm tones indicate lower confidence, cool tones higher.
            </div>
          )}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        style={{ maxHeight: "200px", opacity: cells.length > 0 ? 1 : 0, transition: "opacity 200ms ease-out" }}
      >
        {cells.map(({ article, path }) => (
          <path
            key={article.slug}
            d={path}
            fill={confidenceColor(article.confidence)}
            fillOpacity={hoveredSlug === article.slug ? 0.9 : 0.55}
            stroke="var(--color-border)"
            strokeWidth="1"
            className="transition-all duration-120 cursor-pointer"
            onMouseEnter={(e) => {
              setHoveredSlug(article.slug)
              const rect = svgRef.current?.getBoundingClientRect()
              if (rect) {
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, article })
              }
            }}
            onMouseMove={(e) => {
              const rect = svgRef.current?.getBoundingClientRect()
              if (rect) {
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, article })
              }
            }}
            onMouseLeave={() => {
              setHoveredSlug(null)
              setTooltip(null)
            }}
            onClick={() => router.push(`/app/${engramSlug}/article/${article.slug}`)}
          />
        ))}
      </svg>
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-surface/95 backdrop-blur-md border border-border px-3 py-2 z-10"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="text-[11px] text-text-emphasis">{tooltip.article.title}</p>
          <p className="text-[10px] font-mono text-text-ghost mt-0.5">
            {Math.round(tooltip.article.confidence * 100)}% confidence · {tooltip.article.sourceCount} source{tooltip.article.sourceCount !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  )
}
