"use client"

import { useEffect, useRef } from "react"

interface SlidePanelProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
}

export default function SlidePanel({ isOpen, onClose, children }: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose()
    }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isOpen, onClose])

  return (
    <div
      className={`fixed top-0 right-0 h-full z-40 transition-transform duration-300 ease-out ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
      style={{ width: "400px" }}
    >
      <div
        ref={panelRef}
        className="h-full bg-surface-raised border-l border-border flex flex-col"
      >
        <div className="flex items-center justify-end px-4 py-3 shrink-0">
          <button
            onClick={onClose}
            className="text-text-ghost hover:text-text-secondary transition-colors duration-150 cursor-pointer text-sm font-mono"
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {children}
        </div>
      </div>
    </div>
  )
}
