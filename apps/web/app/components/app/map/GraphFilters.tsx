"use client"

import { useState } from "react"

export interface GraphFilterState {
  types: Set<string>
  minConfidence: number
  searchQuery: string
}

const typeConfig: { id: string; label: string; color: string }[] = [
  { id: "concept", label: "Concept", color: "bg-[#6B80F0]" },
  { id: "process", label: "Process", color: "bg-[#F09E4D]" },
  { id: "event", label: "Event", color: "bg-[#9ED98C]" },
  { id: "synthesis", label: "Synthesis", color: "bg-[#C76BC7]" },
]

interface GraphFiltersProps {
  filters: GraphFilterState
  onChange: (filters: GraphFilterState) => void
  totalNodes: number
  visibleNodes: number
}

export default function GraphFilters({ filters, onChange, totalNodes, visibleNodes }: GraphFiltersProps) {
  const [open, setOpen] = useState(false)

  const toggleType = (type: string) => {
    const next = new Set(filters.types)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onChange({ ...filters, types: next })
  }

  return (
    <div className="absolute top-[52px] left-[calc(50%+42px)] -translate-x-1/2 z-20 pointer-events-auto flex flex-col items-start gap-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="bg-surface/80 backdrop-blur-md border border-border-emphasis hover:border-text-tertiary rounded-sm px-4 py-2 flex items-center gap-2 text-xs text-text-secondary hover:text-text-emphasis transition-all duration-120 cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {visibleNodes < totalNodes ? `${visibleNodes}/${totalNodes}` : "Filter"}
        </button>
      ) : (
        <div className="bg-surface/90 backdrop-blur-md border border-border rounded-sm px-4 py-3 min-w-[240px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Filter</span>
            <button onClick={() => setOpen(false)} className="text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <input
            value={filters.searchQuery}
            onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
            placeholder="Search nodes..."
            className="w-full bg-surface border border-border px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-120 mb-3"
          />

          {/* Types */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {typeConfig.map(t => {
              const isOn = filters.types.size === 0 || filters.types.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleType(t.id)}
                  className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 border transition-colors duration-120 cursor-pointer ${
                    isOn ? "text-text-secondary border-border-emphasis" : "text-text-ghost border-border opacity-40"
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${t.color}`} />
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Confidence */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono text-text-ghost">Min confidence</span>
              <span className="text-[9px] font-mono text-text-ghost">{Math.round(filters.minConfidence * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={filters.minConfidence * 100}
              onChange={(e) => onChange({ ...filters, minConfidence: parseInt(e.target.value) / 100 })}
              className="w-full h-1 appearance-none bg-border rounded-sm cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-text-tertiary [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>

          {/* Count */}
          <p className="text-[9px] font-mono text-text-ghost mt-2">{visibleNodes} of {totalNodes} nodes</p>
        </div>
      )}
    </div>
  )
}
