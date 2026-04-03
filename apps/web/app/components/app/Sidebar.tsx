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

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface flex flex-col h-full">
      <div className="px-5 py-2.5 border-b border-border flex items-center">
        <Link href="/app" className="font-heading text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-150">
          engrams
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {engrams.map((e) => {
          const isActive = activeSlug === e.slug
          return (
            <Link
              key={e.id}
              href={`/app/${e.slug}`}
              className={`flex items-center gap-3 px-5 py-2.5 transition-colors duration-150 border-l-2 ${
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
      </nav>

      <div className="px-2 pb-2">
        {creating ? (
          <div className="px-2 py-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false) }}
              placeholder="Name your engram"
              className="w-full bg-transparent border-b border-border-emphasis text-sm text-text-primary placeholder:text-text-ghost outline-none py-1"
            />
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full text-left px-3 py-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors duration-150 cursor-pointer"
          >
            Form new engram
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-text-tertiary truncate">{profile?.display_name ?? profile?.email}</span>
        <button onClick={handleSignOut} className="text-xs text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer">
          Sign out
        </button>
      </div>
    </aside>
  )
}
