"use client"

import { useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import { slugifyHeading } from "@/lib/slugify-heading"
import hljs from "highlight.js/lib/core"
import javascript from "highlight.js/lib/languages/javascript"
import typescript from "highlight.js/lib/languages/typescript"
import python from "highlight.js/lib/languages/python"
import bash from "highlight.js/lib/languages/bash"
import json from "highlight.js/lib/languages/json"
import css from "highlight.js/lib/languages/css"
import xml from "highlight.js/lib/languages/xml"
import sql from "highlight.js/lib/languages/sql"
import rust from "highlight.js/lib/languages/rust"
import go from "highlight.js/lib/languages/go"
import java from "highlight.js/lib/languages/java"
import cpp from "highlight.js/lib/languages/cpp"
import markdown from "highlight.js/lib/languages/markdown"
import yaml from "highlight.js/lib/languages/yaml"

hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("python", python)
hljs.registerLanguage("py", python)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sh", bash)
hljs.registerLanguage("shell", bash)
hljs.registerLanguage("json", json)
hljs.registerLanguage("css", css)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("go", go)
hljs.registerLanguage("java", java)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("c", cpp)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("md", markdown)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("yml", yaml)

interface ArticleContentProps {
  contentMd: string
  engramSlug: string
  linkPrefix?: string
  /**
   * Slugs of articles that actually exist in the current engram. When
   * provided, [[wikilinks]] pointing to slugs NOT in this set render
   * in text-ghost with a "not yet compiled" title tooltip, so readers
   * see the broken reference without clicking through. Omit to
   * disable broken-link detection (all wiki-links render as active).
   */
  knownSlugs?: Set<string>
}

function WikiLink({
  slug,
  engramSlug,
  linkPrefix,
  broken,
}: {
  slug: string
  engramSlug: string
  linkPrefix?: string
  broken?: boolean
}) {
  const base = linkPrefix ?? `/app/${engramSlug}`
  if (broken) {
    // Render the missing target as a quiet ghost span — no link, no
    // underline, a title tooltip for the curious reader. Clicking
    // nothing is the right affordance: there's nothing to navigate to.
    return (
      <span
        className="text-text-ghost italic cursor-help"
        title="Not yet compiled. This target does not exist in the engram."
      >
        {slug.replace(/-/g, " ")}
      </span>
    )
  }
  return (
    <Link
      href={`${base}/article/${slug}`}
      className="text-text-secondary hover:text-text-emphasis transition-colors duration-120 border-b border-border hover:border-text-tertiary"
    >
      {slug.replace(/-/g, " ")}
    </Link>
  )
}

function processWikiLinks(
  text: string,
  engramSlug: string,
  linkPrefix: string | undefined,
  knownSlugs: Set<string> | undefined,
): React.ReactNode[] {
  const parts = text.split(/(\[\[[^\]]+\]\])/)
  return parts.map((part, i) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/)
    if (match) {
      const slug = match[1]
      const broken = knownSlugs ? !knownSlugs.has(slug) : false
      return (
        <WikiLink
          key={i}
          slug={slug}
          engramSlug={engramSlug}
          linkPrefix={linkPrefix}
          broken={broken}
        />
      )
    }
    return part
  })
}

// Extract a plain-text key from react-markdown heading children so we
// can slug the heading and emit a stable id. react-markdown passes
// either a string, a React element, or an array; this function walks
// the tree and concatenates the text leaves.
function headingText(children: React.ReactNode): string {
  if (children === null || children === undefined) return ""
  if (typeof children === "string") return children
  if (typeof children === "number") return String(children)
  if (Array.isArray(children)) return children.map(headingText).join("")
  if (typeof children === "object" && "props" in children) {
    // @ts-expect-error — ReactElement children access
    return headingText(children.props?.children)
  }
  return ""
}

function CodeBlock({ html, lang, code }: { html: string; lang: string; code: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    if (buttonRef.current) {
      buttonRef.current.textContent = "copied"
      setTimeout(() => { if (buttonRef.current) buttonRef.current.textContent = "copy" }, 1500)
    }
  }, [code])

  return (
    <div className="relative group bg-surface-raised border border-border overflow-x-auto scrollbar-hidden mb-4">
      <div className="absolute top-0 right-0 flex items-center gap-2 px-3 py-1.5">
        <span className="font-mono text-[10px] text-text-ghost">{lang}</span>
        <button
          ref={buttonRef}
          onClick={handleCopy}
          className="font-mono text-[10px] text-text-ghost hover:text-text-tertiary transition-colors duration-120 opacity-0 group-hover:opacity-100 cursor-pointer"
        >
          copy
        </button>
      </div>
      <code
        className="block p-4 pt-8 font-mono text-xs text-text-secondary hljs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export default function ArticleContent({
  contentMd,
  engramSlug,
  linkPrefix,
  knownSlugs,
}: ArticleContentProps) {
  // Heading id collision tracking. react-markdown walks the tree in
  // document order so a simple counter per slugified id resolves dups
  // deterministically and matches the algorithm in slugifyHeadings.
  // Reset the counter each render by keying it on contentMd.
  const headingCounts = useMemo(() => new Map<string, number>(), [contentMd])
  const makeHeadingId = (children: React.ReactNode): string => {
    const text = headingText(children)
    const base = slugifyHeading(text) || "section"
    const count = headingCounts.get(base) ?? 0
    headingCounts.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }

  const components: Components = {
    p({ children }) {
      return <p className="mb-4">{processChildren(children, engramSlug, linkPrefix, knownSlugs)}</p>
    },
    h1({ children }) {
      return <h1 className="font-heading text-xl text-text-emphasis mt-8 mb-3">{children}</h1>
    },
    h2({ children }) {
      const id = makeHeadingId(children)
      return (
        <h2
          id={id}
          className="font-heading text-lg text-text-emphasis mt-6 mb-2 scroll-mt-24"
        >
          {children}
        </h2>
      )
    },
    h3({ children }) {
      const id = makeHeadingId(children)
      return (
        <h3
          id={id}
          className="font-heading text-base text-text-emphasis mt-5 mb-2 scroll-mt-24"
        >
          {children}
        </h3>
      )
    },
    ul({ children }) {
      return <ul className="list-disc list-outside ml-5 mb-4 space-y-1">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-outside ml-5 mb-4 space-y-1">{children}</ol>
    },
    li({ children }) {
      return <li>{processChildren(children, engramSlug, linkPrefix, knownSlugs)}</li>
    },
    strong({ children }) {
      return <strong className="text-text-emphasis font-medium">{children}</strong>
    },
    em({ children }) {
      return <em className="italic">{children}</em>
    },
    code({ children, className }) {
      const langMatch = className?.match(/language-(\w+)/)
      const lang = langMatch?.[1]
      if (lang) {
        const code = String(children).replace(/\n$/, "")
        let highlighted: string
        try {
          highlighted = hljs.highlight(code, { language: lang }).value
        } catch {
          highlighted = hljs.highlightAuto(code).value
        }
        return <CodeBlock html={highlighted} lang={lang} code={code} />
      }
      return (
        <code className="bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-text-secondary">
          {children}
        </code>
      )
    },
    pre({ children }) {
      return <pre className="mb-4">{children}</pre>
    },
    blockquote({ children }) {
      return (
        <blockquote className="border-l-2 border-border-emphasis pl-4 text-text-secondary italic mb-4">
          {children}
        </blockquote>
      )
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-text-emphasis transition-colors duration-120 border-b border-border hover:border-text-tertiary">
          {children}
        </a>
      )
    },
    hr() {
      return <hr className="border-border my-6" />
    },
  }

  return <ReactMarkdown components={components}>{contentMd}</ReactMarkdown>
}

function processChildren(
  children: React.ReactNode,
  engramSlug: string,
  linkPrefix: string | undefined,
  knownSlugs: Set<string> | undefined,
): React.ReactNode {
  if (typeof children === "string") {
    return processWikiLinks(children, engramSlug, linkPrefix, knownSlugs)
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        const processed = processWikiLinks(child, engramSlug, linkPrefix, knownSlugs)
        return processed.length === 1 ? processed[0] : <span key={i}>{processed}</span>
      }
      return child
    })
  }
  return children
}
