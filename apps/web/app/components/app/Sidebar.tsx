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

type Phase = "expanded" | "fading-out" | "shrinking" | "collapsed" | "expanding" | "fading-in"

export function Sidebar({ engrams, profile }: { engrams: Engram[]; profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [phase, setPhase] = useState<Phase>("expanded")
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)

  const activeSlug = pathname.split("/")[2] ?? ""
  const showExpanded = phase === "expanded" || phase === "fading-out" || phase === "fading-in"
  const showCollapsed = phase === "collapsed" || phase === "expanding" || phase === "shrinking"

  const collapse = () => {
    if (phase !== "expanded") return
    setPhase("fading-out")
    setTimeout(() => setPhase("shrinking"), 150)
    setTimeout(() => setPhase("collapsed"), 400)
  }

  const expand = () => {
    if (phase !== "collapsed") return
    setPhase("expanding")
    setTimeout(() => setPhase("fading-in"), 250)
    setTimeout(() => setPhase("expanded"), 450)
  }

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

  const handleDelete = async (id: string, slug: string) => {
    const supabase = createClient()
    await supabase.from("engrams").delete().eq("id", id)
    setSettingsOpen(null)
    if (activeSlug === slug) router.push("/app")
    router.refresh()
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  const sidebarWidth = phase === "shrinking" || phase === "collapsed" ? 40 : 224
  const expandedOpacity = phase === "fading-out" ? 0 : (phase === "fading-in" || phase === "expanded") ? 1 : 0
  const collapsedOpacity = phase === "collapsed" ? 1 : 0

  return (
    <aside
      className="shrink-0 border-r border-border bg-surface flex flex-col h-full overflow-hidden"
      style={{ width: sidebarWidth, transition: "width 250ms cubic-bezier(0.4, 0, 0.2, 1)" }}
    >
      {showCollapsed && (
        <div
          className="absolute inset-y-0 left-0 w-10 flex flex-col items-center z-10"
          style={{ opacity: collapsedOpacity, transition: "opacity 200ms ease-out" }}
        >
          <button onClick={expand} className="mt-3 text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <div className="flex flex-col items-center gap-2.5 mt-4">
            {engrams.map((e) => (
              <Link key={e.id} href={`/app/${e.slug}`} title={e.name}>
                <div className={`w-2 h-2 rounded-full transition-all duration-150 ${activeSlug === e.slug ? "scale-125" : "opacity-50 hover:opacity-100"}`}
                  style={{ backgroundColor: e.accent_color }} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {showExpanded && (
        <div className="flex flex-col h-full min-w-[224px]" style={{ opacity: expandedOpacity, transition: "opacity 150ms ease-out" }}>
          <nav className="flex-1 overflow-y-auto">
            <button onClick={collapse} className="w-full flex items-center justify-between px-5 pt-4 pb-3 cursor-pointer group">
              <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase group-hover:text-text-tertiary transition-colors duration-150">Your engrams</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-text-ghost opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            {engrams.map((e) => {
              const isActive = activeSlug === e.slug
              return (
                <div key={e.id} className="relative group">
                  <Link
                    href={`/app/${e.slug}`}
                    className={`flex items-center gap-2.5 px-5 py-1.5 transition-colors duration-150 border-l-2 ${
                      isActive
                        ? "text-text-emphasis bg-surface-elevated"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-raised border-transparent"
                    }`}
                    style={{ borderLeftColor: isActive ? e.accent_color : undefined }}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{e.name}</span>
                      <span className="block text-[10px] text-text-ghost mt-0.5">
                        {e.source_count} source{e.source_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </Link>

                  {/* Three-dot menu */}
                  <button
                    onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setSettingsOpen(settingsOpen === e.id ? null : e.id) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-ghost opacity-0 group-hover:opacity-100 hover:text-text-tertiary transition-all duration-150 cursor-pointer px-1 py-0.5"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>

                  {/* Settings dropdown */}
                  {settingsOpen === e.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(null)} />
                      <div className="absolute right-1 top-full z-50 bg-surface-raised border border-border py-1 min-w-[120px]">
                        <Link
                          href={`/app/${e.slug}/settings`}
                          onClick={() => setSettingsOpen(null)}
                          className="block px-3 py-1.5 text-xs text-text-secondary hover:text-text-emphasis hover:bg-surface-elevated transition-colors duration-150"
                        >
                          Settings
                        </Link>
                        <button
                          onClick={() => handleDelete(e.id, e.slug)}
                          className="block w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-elevated transition-colors duration-150 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
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
                    onBlur={() => { setCreating(false); setNewName("") }}
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

          <div className="px-5 py-3 border-t border-border flex items-center justify-between">
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
      )}
    </aside>
  )
}
