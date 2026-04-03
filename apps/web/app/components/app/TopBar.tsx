"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import CompilationPulse from "./CompilationPulse"

export function TopBar() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const engramSlug = segments[1]
  const section = segments[2]

  const primaryNav = engramSlug
    ? [
        { label: "Articles", href: `/app/${engramSlug}` },
        { label: "Map", href: `/app/${engramSlug}/map` },
        { label: "Feed", href: `/app/${engramSlug}/feed` },
        { label: "Ask", href: `/app/${engramSlug}/ask` },
      ]
    : []

  const secondaryNav = engramSlug
    ? [
        { label: "Sources", href: `/app/${engramSlug}/sources` },
        { label: "Health", href: `/app/${engramSlug}/health` },
        { label: "Timeline", href: `/app/${engramSlug}/timeline` },
      ]
    : []

  return (
    <>
    <CompilationPulse engramSlug={engramSlug} />
    <header className="h-11 shrink-0 border-b border-border flex items-center px-4 gap-6">
      {engramSlug && (
        <span className="font-mono text-xs text-text-tertiary">{engramSlug}</span>
      )}
      <nav className="flex items-center gap-4">
        {primaryNav.map((item) => {
          const isActive = item.href === pathname || (item.href === `/app/${engramSlug}` && !section)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`text-xs transition-colors duration-150 ${
                isActive ? "text-text-emphasis" : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
        {secondaryNav.length > 0 && (
          <>
            <span className="w-px h-3 bg-border" />
            {secondaryNav.map((item) => {
              const isActive = item.href === pathname
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-[10px] transition-colors duration-150 ${
                    isActive ? "text-text-emphasis" : "text-text-ghost hover:text-text-tertiary"
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </>
        )}
      </nav>
    </header>
    </>
  )
}
