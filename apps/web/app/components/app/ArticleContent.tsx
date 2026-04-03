"use client"

import Link from "next/link"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"

interface ArticleContentProps {
  contentMd: string
  engramSlug: string
}

function WikiLink({ slug, engramSlug }: { slug: string; engramSlug: string }) {
  return (
    <Link
      href={`/app/${engramSlug}/article/${slug}`}
      className="text-text-secondary hover:text-text-emphasis transition-colors duration-150 border-b border-border hover:border-text-tertiary"
    >
      {slug.replace(/-/g, " ")}
    </Link>
  )
}

function processWikiLinks(text: string, engramSlug: string): React.ReactNode[] {
  const parts = text.split(/(\[\[[^\]]+\]\])/)
  return parts.map((part, i) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/)
    if (match) {
      return <WikiLink key={i} slug={match[1]} engramSlug={engramSlug} />
    }
    return part
  })
}

export default function ArticleContent({ contentMd, engramSlug }: ArticleContentProps) {
  // Pre-process: temporarily replace [[slug]] with placeholders for markdown parsing,
  // then restore them. Simpler approach: use custom components to handle text nodes.
  const components: Components = {
    p({ children }) {
      return <p className="mb-4">{processChildren(children, engramSlug)}</p>
    },
    h1({ children }) {
      return <h1 className="font-heading text-xl text-text-emphasis mt-8 mb-3">{children}</h1>
    },
    h2({ children }) {
      return <h2 className="font-heading text-lg text-text-emphasis mt-6 mb-2">{children}</h2>
    },
    h3({ children }) {
      return <h3 className="font-heading text-base text-text-emphasis mt-5 mb-2">{children}</h3>
    },
    ul({ children }) {
      return <ul className="list-disc list-outside ml-5 mb-4 space-y-1">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-outside ml-5 mb-4 space-y-1">{children}</ol>
    },
    li({ children }) {
      return <li>{processChildren(children, engramSlug)}</li>
    },
    strong({ children }) {
      return <strong className="text-text-emphasis font-medium">{children}</strong>
    },
    em({ children }) {
      return <em className="italic">{children}</em>
    },
    code({ children, className }) {
      const isBlock = className?.includes("language-")
      if (isBlock) {
        return (
          <code className={`block bg-surface-raised border border-border p-4 font-mono text-xs text-text-secondary overflow-x-auto mb-4 ${className ?? ""}`}>
            {children}
          </code>
        )
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
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-text-emphasis transition-colors duration-150 border-b border-border hover:border-text-tertiary">
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

function processChildren(children: React.ReactNode, engramSlug: string): React.ReactNode {
  if (typeof children === "string") {
    return processWikiLinks(children, engramSlug)
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        const processed = processWikiLinks(child, engramSlug)
        return processed.length === 1 ? processed[0] : <span key={i}>{processed}</span>
      }
      return child
    })
  }
  return children
}
