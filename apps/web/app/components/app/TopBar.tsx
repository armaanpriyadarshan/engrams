"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import CompilationPulse from "./CompilationPulse"
import CurrentActivityLine from "./CurrentActivityLine"

export function TopBar() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const engramSlug = segments[1]

  return (
    <>
      <CompilationPulse engramSlug={engramSlug} />
      <header className="h-11 shrink-0 border-b border-border flex items-center px-5 gap-3">
        <Link href="/app" className="font-heading text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-120">
          engrams
        </Link>
        {engramSlug && (
          <>
            <span className="text-text-ghost text-xs">/</span>
            <Link href={`/app/${engramSlug}`} className="font-mono text-xs text-text-tertiary hover:text-text-secondary transition-colors duration-120">
              {engramSlug}
            </Link>
          </>
        )}
        <div className="flex-1 flex justify-end min-w-0 pl-4">
          <CurrentActivityLine engramSlug={engramSlug} />
        </div>
      </header>
    </>
  )
}
