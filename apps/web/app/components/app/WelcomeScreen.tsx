"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

const COFFEE_SOURCES = [
  {
    type: "text",
    title: "Coffee processing methods",
    content: `Coffee processing refers to the methods used to remove the outer fruit from the coffee cherry to reveal the green coffee bean inside. The three primary methods are washed (wet), natural (dry), and honey (semi-washed). Washed coffees tend to have cleaner, brighter acidity and allow terroir to shine through. Natural processed coffees develop heavier body and fruit-forward sweetness as the bean ferments inside the cherry. Honey processing sits between the two, leaving varying amounts of mucilage on the bean during drying, creating a spectrum from white honey (least mucilage) to black honey (most). Each method dramatically affects the final cup profile.`,
  },
  {
    type: "text",
    title: "Espresso extraction fundamentals",
    content: `Espresso extraction is governed by several interdependent variables: dose (typically 18-20g), yield (usually 36-40g for a double), grind size, water temperature (usually 90-96°C), and pressure (9 bars standard). The extraction percentage—how much of the coffee's soluble material dissolves into the water—ideally falls between 18-22%. Under-extraction produces sour, thin shots while over-extraction yields bitter, astringent cups. The concept of the extraction curve shows that acids extract first, then sugars and sweetness, then bitter compounds. Channeling—where water finds paths of least resistance through the puck—is the most common extraction flaw and is combated through proper distribution and tamping technique.`,
  },
  {
    type: "text",
    title: "Third wave coffee movement",
    content: `The third wave coffee movement treats coffee as an artisanal food rather than a commodity. It emphasizes single-origin sourcing, direct trade relationships with farmers, lighter roast profiles that preserve origin character, and precise brewing methods. Key figures include the founders of Intelligentsia, Counter Culture, and Stumptown in the early 2000s. The movement introduced concepts like cupping scores (specialty coffee scores 80+ on a 100-point scale), traceability to specific farms and lots, and seasonal offerings. It shifted consumer attention from blends to single origins and from dark roasts to lighter profiles that highlight a coffee's unique terroir—its altitude, varietal, soil, and microclimate.`,
  },
]

interface WelcomeScreenProps {
  userId: string
}

export default function WelcomeScreen({ userId }: WelcomeScreenProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [loadingSample, setLoadingSample] = useState(false)

  const createEngram = async (name: string) => {
    const supabase = createClient()
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    const { data, error } = await supabase
      .from("engrams")
      .insert({ owner_id: userId, name: name.trim(), slug })
      .select("id, slug")
      .single()
    if (error || !data) return null
    return data
  }

  const handleCreateBlank = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const engram = await createEngram(newName.trim())
    if (engram) {
      router.push(`/app/${engram.slug}`)
      router.refresh()
    }
    setCreating(false)
  }

  const handleSampleProject = async () => {
    setLoadingSample(true)
    const engram = await createEngram("Coffee")
    if (!engram) { setLoadingSample(false); return }

    const supabase = createClient()

    // Insert sample sources
    for (const src of COFFEE_SOURCES) {
      const { data: source } = await supabase.from("sources").insert({
        engram_id: engram.id,
        source_type: src.type,
        content_md: src.content,
        title: src.title,
        status: "pending",
      }).select("id").single()

      if (source) {
        await supabase.rpc("increment_source_count", { eid: engram.id })
        // Fire compilation without waiting
        supabase.functions.invoke("compile-source", {
          body: { source_id: source.id },
        })
      }
    }

    router.push(`/app/${engram.slug}`)
    router.refresh()
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="max-w-lg w-full px-6">
        {/* Header */}
        <div className="mb-12">
          <h1 className="font-heading text-xl text-text-emphasis tracking-tight">Welcome to engrams</h1>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            A living knowledge organism. Feed it sources, and it compiles them into structured, interlinked knowledge you can browse, query, and visualize.
          </p>
        </div>

        {/* Start section */}
        <div className="space-y-6">
          {/* Sample project */}
          <div>
            <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Start with a sample</span>
            <button
              onClick={handleSampleProject}
              disabled={loadingSample}
              className="mt-2 w-full group border border-border hover:border-border-emphasis bg-surface p-4 text-left transition-all duration-120 cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 mt-1.5 rounded-full shrink-0 bg-confidence-high" />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm text-text-primary group-hover:text-text-emphasis transition-colors duration-120">
                    {loadingSample ? "Forming..." : "Coffee"}
                  </span>
                  <span className="block text-xs text-text-tertiary mt-1 leading-relaxed">
                    Processing methods, espresso extraction, third wave movement. 3 sources, ready to compile.
                  </span>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-ghost group-hover:text-text-tertiary mt-1 shrink-0 transition-colors duration-120">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-[10px] font-mono text-text-ghost">or</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* Create blank */}
          <div>
            <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Form a new engram</span>
            <div className="mt-2 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateBlank() }}
                placeholder="Name your engram"
                className="flex-1 bg-surface border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-120"
              />
              <button
                onClick={handleCreateBlank}
                disabled={creating || !newName.trim()}
                className="bg-text-primary text-void px-4 py-2.5 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-20 disabled:cursor-default transition-colors duration-120 shrink-0"
              >
                {creating ? "..." : "Form"}
              </button>
            </div>
          </div>
        </div>

        {/* Quick reference */}
        <div className="mt-12 pt-6 border-t border-border">
          <div className="grid grid-cols-3 gap-4">
            {[
              { verb: "Feed", desc: "Add sources from anywhere" },
              { verb: "Compile", desc: "Watch it build your wiki" },
              { verb: "Ask", desc: "Query your knowledge" },
            ].map((step) => (
              <div key={step.verb}>
                <span className="text-xs text-text-primary">{step.verb}</span>
                <p className="text-[11px] text-text-ghost mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
