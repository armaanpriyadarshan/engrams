"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import CompilationPulse from "./CompilationPulse"

export function TopBar() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const engramSlug = segments[1]
  const [menuOpen, setMenuOpen] = useState(false)

  const moreLinks = engramSlug
    ? [
        { label: "Articles", href: `/app/${engramSlug}/feed` },
        { label: "Sources", href: `/app/${engramSlug}/sources` },
        { label: "Health", href: `/app/${engramSlug}/health` },
        { label: "Timeline", href: `/app/${engramSlug}/timeline` },
        { label: "Settings", href: `/app/${engramSlug}/settings` },
      ]
    : []

  return (
    <>
    <CompilationPulse engramSlug={engramSlug} />
    <header className="h-11 shrink-0 border-b border-border flex items-center px-4 gap-4">
      {engramSlug && (
        <Link href={`/app/${engramSlug}`} className="font-mono text-xs text-text-tertiary hover:text-text-secondary transition-colors duration-150">
          {engramSlug}
        </Link>
      )}

      <div className="flex-1" />

      {engramSlug && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-xs font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer px-2 py-1"
          >
            &middot;&middot;&middot;
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-surface-raised border border-border py-1 min-w-[140px]">
                {moreLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={`block px-4 py-2 text-xs transition-colors duration-150 ${
                      pathname === item.href ? "text-text-emphasis" : "text-text-secondary hover:text-text-emphasis hover:bg-surface-elevated"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </header>
    </>
  )
}
