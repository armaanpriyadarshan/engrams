"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface Engram {
  id: string
  name: string
  slug: string
  accent_color: string
  article_count: number
  source_count: number
}

interface Profile {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

export function Sidebar({ engrams, profile }: { engrams: Engram[]; profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [collapsed, setCollapsed] = useState(false)

  const activeSlug = pathname.split("/")[2] ?? ""

  const handleCreate = async () => {
    if (!newName.trim()) return
    const supabase = createClient()
    const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    const { data, error } = await supabase
      .from("engrams")
      .insert({ owner_id: profile?.id, name: newName.trim(), slug })
      .select("slug")
      .single()

    if (!error && data) {
      setNewName("")
      setCreating(false)
      router.push(`/app/${data.slug}`)
      router.refresh()
    }
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  // Collapsed: thin strip with toggle button
  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 border-r border-border bg-surface flex flex-col h-full items-center">
        <button
          onClick={() => setCollapsed(false)}
          className="mt-3 text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer"
          title="Expand sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div className="flex-1 flex flex-col items-center gap-2 mt-4">
          {engrams.map((e) => (
            <Link key={e.id} href={`/app/${e.slug}`} title={e.name}>
              <div
                className={`w-2 h-2 rounded-full transition-all duration-150 ${activeSlug === e.slug ? "scale-125" : "opacity-50 hover:opacity-100"}`}
                style={{ backgroundColor: e.accent_color }}
              />
            </Link>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface flex flex-col h-full transition-all duration-200">
      <nav className="flex-1 overflow-y-auto">
        <button
          onClick={() => setCollapsed(true)}
          className="w-full flex items-center justify-between px-5 pt-4 pb-2 cursor-pointer group"
        >
          <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase group-hover:text-text-tertiary transition-colors duration-150">Your engrams</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className="text-text-ghost opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {engrams.map((e) => {
          const isActive = activeSlug === e.slug
          return (
            <Link
              key={e.id}
              href={`/app/${e.slug}`}
              className={`flex items-center gap-2.5 px-5 py-1.5 transition-colors duration-150 border-l-2 ${
                isActive
                  ? "text-text-emphasis bg-surface-elevated"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-raised border-transparent"
              }`}
              style={{ borderLeftColor: isActive ? e.accent_color : undefined }}
            >
              <div className="min-w-0">
                <span className="block text-sm truncate">{e.name}</span>
                <span className="block text-[10px] text-text-ghost mt-0.5">
                  {e.source_count} source{e.source_count !== 1 ? "s" : ""}
                </span>
              </div>
            </Link>
          )
        })}

        <div className="mt-3">
          {creating ? (
            <div className="px-5 py-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false) }}
                placeholder="Name your engram"
                className="w-full bg-transparent border-b border-border-emphasis text-xs text-text-primary placeholder:text-text-ghost outline-none py-1"
              />
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 px-5 py-1.5 text-xs text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer"
            >
              <span className="text-sm leading-none">+</span>
              Form new engram
            </button>
          )}
        </div>
      </nav>

      <div className="px-5 py-3 border-t border-border space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-mono text-text-ghost">
          <span>{engrams.reduce((s, e) => s + e.article_count, 0)} nodes</span>
          <span>&middot;</span>
          <span>{engrams.reduce((s, e) => s + e.source_count, 0)} edges</span>
        </div>
        <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary truncate lowercase">{profile?.display_name ?? profile?.email}</span>
        <button onClick={handleSignOut} className="text-text-ghost hover:text-danger transition-colors duration-150 cursor-pointer shrink-0" title="Sign out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
        </div>
      </div>
    </aside>
  )
}
