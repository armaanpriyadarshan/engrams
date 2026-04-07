"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface CompilationToastProps {
  engramId: string
}

interface ToastMessage {
  id: string
  text: string
}

export default function CompilationToast({ engramId }: CompilationToastProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`compilation-${engramId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "compilation_runs",
          filter: `engram_id=eq.${engramId}`,
        },
        (payload) => {
          const run = payload.new as { id?: string; status?: string; articles_created?: number; articles_updated?: number; edges_created?: number }
          if (run.status === "completed") {
            const created = run.articles_created ?? 0
            const updated = run.articles_updated ?? 0
            const edges = run.edges_created ?? 0

            const parts: string[] = []
            if (created > 0) parts.push(`${created} created`)
            if (updated > 0) parts.push(`${updated} updated`)
            if (edges > 0) parts.push(`${edges} connection${edges !== 1 ? "s" : ""} found`)

            const text = parts.length > 0
              ? parts.join(". ") + "."
              : "Compilation complete."

            const id = run.id ?? crypto.randomUUID()
            setToasts((prev) => [...prev, { id, text }])

            // Auto-dismiss after 4 seconds
            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== id))
            }, 4000)

            // Refresh the page data
            router.refresh()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [engramId, router])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-surface-raised border border-border px-4 py-3 text-xs text-text-secondary font-mono animate-fade-in"
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}
