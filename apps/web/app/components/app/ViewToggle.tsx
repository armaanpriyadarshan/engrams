"use client"

import { useState } from "react"

export default function ViewToggle({ onViewChange }: { onViewChange?: (view: "graph" | "list") => void }) {
  const [view, setView] = useState<"graph" | "list">("graph")

  const toggle = (v: "graph" | "list") => {
    setView(v)
    onViewChange?.(v)
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex flex-col items-center gap-2.5">
      {/* Toggle pill */}
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm flex">
        <button
          onClick={() => toggle("graph")}
          className={`px-3 py-1.5 transition-colors duration-150 cursor-pointer ${
            view === "graph" ? "text-text-emphasis bg-surface-elevated" : "text-text-ghost hover:text-text-tertiary"
          }`}
          title="Graph view"
        >
          {/* Network/graph icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="6" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
            <circle cx="12" cy="12" r="2" />
            <line x1="7.8" y1="7.2" x2="10.5" y2="10.5" />
            <line x1="16.2" y1="7.2" x2="13.5" y2="10.5" />
            <line x1="7.8" y1="16.8" x2="10.5" y2="13.5" />
            <line x1="16.2" y1="16.8" x2="13.5" y2="13.5" />
          </svg>
        </button>
        <div className="w-px bg-border" />
        <button
          onClick={() => toggle("list")}
          className={`px-3 py-1.5 transition-colors duration-150 cursor-pointer ${
            view === "list" ? "text-text-emphasis bg-surface-elevated" : "text-text-ghost hover:text-text-tertiary"
          }`}
          title="List view"
        >
          {/* List/text icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
