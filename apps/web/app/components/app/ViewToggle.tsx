"use client"

import { useState } from "react"

export default function ViewToggle({ onViewChange }: { onViewChange?: (view: "graph" | "wiki") => void }) {
  const [view, setView] = useState<"graph" | "wiki">("graph")

  const toggle = (v: "graph" | "wiki") => {
    setView(v)
    onViewChange?.(v)
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex flex-col items-center gap-2.5 animate-slide-in-up" style={{ animationDelay: "100ms" }}>
      {/* Toggle pill */}
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm flex">
        <button
          onClick={() => toggle("graph")}
          className={`px-3 py-1.5 transition-colors duration-120 cursor-pointer ${
            view === "graph" ? "text-text-emphasis bg-surface-elevated" : "text-text-ghost hover:text-text-tertiary"
          }`}
          title="Graph"
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
          onClick={() => toggle("wiki")}
          className={`px-3 py-1.5 transition-colors duration-120 cursor-pointer ${
            view === "wiki" ? "text-text-emphasis bg-surface-elevated" : "text-text-ghost hover:text-text-tertiary"
          }`}
          title="Wiki"
        >
          {/* Book/wiki icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <line x1="8" y1="7" x2="16" y2="7" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>
    </div>
  )
}
