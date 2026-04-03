"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface CompilationPulseProps {
  engramSlug: string | undefined
}

export default function CompilationPulse({ engramSlug }: CompilationPulseProps) {
  const [isCompiling, setIsCompiling] = useState(false)
  const [engramId, setEngramId] = useState<string | null>(null)

  // Resolve slug to ID
  useEffect(() => {
    if (!engramSlug) return
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => setEngramId(data?.id ?? null))
  }, [engramSlug])

  // Subscribe to compilation_runs
  useEffect(() => {
    if (!engramId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`pulse-${engramId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "compilation_runs",
          filter: `engram_id=eq.${engramId}`,
        },
        (payload) => {
          if ((payload.new as any).status === "running") {
            setIsCompiling(true)
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "compilation_runs",
          filter: `engram_id=eq.${engramId}`,
        },
        (payload) => {
          const status = (payload.new as any).status
          if (status === "completed" || status === "failed") {
            setIsCompiling(false)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [engramId])

  return (
    <div
      className={`fixed top-0 left-0 w-full h-[2px] z-50 transition-opacity duration-300 ease-out ${
        isCompiling ? "opacity-100" : "opacity-0"
      }`}
      style={{
        background: "linear-gradient(90deg, transparent, var(--color-agent-active), transparent)",
        backgroundSize: "200% 100%",
        animation: isCompiling ? "compilation-sweep 3s ease-in-out infinite" : "none",
      }}
    />
  )
}
