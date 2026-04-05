"use client"

import { useRef, useCallback } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
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
}

function WikiLink({ slug, engramSlug, linkPrefix }: { slug: string; engramSlug: string; linkPrefix?: string }) {
  const base = linkPrefix ?? `/app/${engramSlug}`
  return (
    <Link
      href={`${base}/article/${slug}`}
      className="text-text-secondary hover:text-text-emphasis transition-colors duration-150 border-b border-border hover:border-text-tertiary"
    >
      {slug.replace(/-/g, " ")}
    </Link>
  )
}

function processWikiLinks(text: string, engramSlug: string, linkPrefix?: string): React.ReactNode[] {
  const parts = text.split(/(\[\[[^\]]+\]\])/)
  return parts.map((part, i) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/)
    if (match) {
      return <WikiLink key={i} slug={match[1]} engramSlug={engramSlug} linkPrefix={linkPrefix} />
    }
    return part
  })
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

export default function ArticleContent({ contentMd, engramSlug, linkPrefix }: ArticleContentProps) {
  // Pre-process: temporarily replace [[slug]] with placeholders for markdown parsing,
  // then restore them. Simpler approach: use custom components to handle text nodes.
  const components: Components = {
    p({ children }) {
      return <p className="mb-4">{processChildren(children, engramSlug, linkPrefix)}</p>
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
      return <li>{processChildren(children, engramSlug, linkPrefix)}</li>
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

function processChildren(children: React.ReactNode, engramSlug: string, linkPrefix?: string): React.ReactNode {
  if (typeof children === "string") {
    return processWikiLinks(children, engramSlug, linkPrefix)
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        const processed = processWikiLinks(child, engramSlug, linkPrefix)
        return processed.length === 1 ? processed[0] : <span key={i}>{processed}</span>
      }
      return child
    })
  }
  return children
}
