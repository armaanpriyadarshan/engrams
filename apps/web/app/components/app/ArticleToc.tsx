"use client"

// ArticleToc — a hairline table-of-contents sidebar that scroll-spies
// the active heading in the reader. Server-rendered from the parsed
// heading list; the client half uses IntersectionObserver to figure
// out which heading is currently in view.
//
// Visibility rules:
//   • Hidden on narrow viewports. The reader column is 660px centered,
//     and below xl the TOC would crowd it — it only appears when
//     there's room for both the column and a sidebar.
//   • Hidden entirely when the article has fewer than 3 h2 headings.
//     Short articles don't need a TOC and a one-item TOC is visual
//     noise.
//
// Scroll target element: looks for `[data-reader-scroll]` walked up
// the DOM from the TOC's own mount, so IntersectionObserver can use
// the right scroll root. Falls back to the document root if none is
// found.

import { useEffect, useRef, useState } from "react"
import type { ParsedHeading } from "@/lib/slugify-heading"

interface ArticleTocProps {
  headings: ParsedHeading[]
}

export default function ArticleToc({ headings }: ArticleTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)

  // Only renders if there are enough h2 headings to justify a TOC.
  // 3 is the minimum that feels useful; anything less is a single
  // link masquerading as a navigation element.
  const h2Count = headings.filter((h) => h.level === 2).length
  const shouldRender = h2Count >= 3

  useEffect(() => {
    if (!shouldRender) return
    // Walk up from the <nav> mount to find the nearest scroll container.
    // The reader pages wrap their scrolling div with data-reader-scroll.
    const tocEl = document.querySelector<HTMLElement>("[data-article-toc]")
    if (!tocEl) return
    let root: HTMLElement | null = tocEl.parentElement
    while (root && !root.hasAttribute("data-reader-scroll")) {
      root = root.parentElement
    }
    rootRef.current = root

    // Build the observer over all h2/h3 ids we know about.
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    // The "active" heading is the first one whose top is above a
    // threshold line (~25% down the viewport). IntersectionObserver
    // with a negative bottom rootMargin implements this cleanly.
    const observer = new IntersectionObserver(
      (entries) => {
        // Collect all currently-intersecting headings and pick the
        // top-most one by document order. IntersectionObserver delivers
        // entries out of order, so we track the full set and re-scan
        // rather than naively using entries[0].
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
        if (visible.length === 0) return
        // Sort by DOM order — querySelectorAll returns document order,
        // so we index in that.
        visible.sort(
          (a, b) =>
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
              ? -1
              : 1,
        )
        setActiveId(visible[0].id)
      },
      {
        root: root,
        // Trigger when the heading crosses the top 25% of the viewport.
        // The bottom margin prevents late-article headings from
        // winning when they haven't actually been read yet.
        rootMargin: "-10% 0% -70% 0%",
        threshold: 0,
      },
    )
    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [headings, shouldRender])

  if (!shouldRender) return null

  return (
    <nav
      data-article-toc
      className="hidden xl:block fixed top-32 right-10 w-52 max-h-[70vh] overflow-y-auto scrollbar-hidden pointer-events-auto"
      aria-label="Article contents"
    >
      <p className="font-mono text-[10px] text-text-ghost tracking-widest uppercase mb-3">
        On this page
      </p>
      <ol className="space-y-1.5">
        {headings.map((h) => {
          const isActive = h.id === activeId
          return (
            <li
              key={h.id}
              className={h.level === 3 ? "pl-3" : ""}
              style={{ lineHeight: 1.35 }}
            >
              <a
                href={`#${h.id}`}
                className={`block text-[12px] transition-colors duration-120 ${
                  isActive
                    ? "text-text-emphasis"
                    : "text-text-ghost hover:text-text-tertiary"
                }`}
                onClick={(e) => {
                  // Smooth scroll without reloading the route. The
                  // browser's default anchor jump is instant which is
                  // jarring against the reader's slow typography.
                  const target = document.getElementById(h.id)
                  if (target) {
                    e.preventDefault()
                    target.scrollIntoView({ behavior: "smooth", block: "start" })
                    // Update the url hash for shareability without
                    // triggering a router navigation.
                    history.replaceState(null, "", `#${h.id}`)
                  }
                }}
              >
                {h.text}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
