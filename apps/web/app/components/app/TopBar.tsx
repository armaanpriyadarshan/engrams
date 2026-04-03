"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import CompilationPulse from "./CompilationPulse"

export function TopBar() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const engramSlug = segments[1]
  const section = segments[2]

  const navItems = engramSlug
    ? [
        { label: "Articles", href: `/app/${engramSlug}` },
        { label: "Feed", href: `/app/${engramSlug}/feed` },
        { label: "Ask", href: `/app/${engramSlug}/ask` },
      ]
    : []

  return (
    <>
    <CompilationPulse engramSlug={engramSlug} />
    <header className="h-11 shrink-0 border-b border-border flex items-center px-4 gap-6">
      {engramSlug && (
        <span className="font-mono text-xs text-text-tertiary">{engramSlug}</span>
      )}
      <nav className="flex gap-4">
        {navItems.map((item) => {
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
      </nav>
    </header>
    </>
  )
}
