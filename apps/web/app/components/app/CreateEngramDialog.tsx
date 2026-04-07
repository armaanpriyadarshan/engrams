"use client"

import { useEffect } from "react"
import CreateEngramForm from "./CreateEngramForm"

interface CreateEngramDialogProps {
  userId: string
  open: boolean
  onClose: () => void
}

export default function CreateEngramDialog({ userId, open, onClose }: CreateEngramDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-6"
      style={{ animation: "fade-in-only 180ms ease-out both" }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-lg bg-surface border border-border-emphasis rounded-sm overflow-hidden"
        style={{ animation: "fade-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both" }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="font-heading text-base text-text-emphasis tracking-tight">Form a new engram</h2>
            <p className="mt-0.5 text-[11px] text-text-ghost">A new knowledge organism. Feed sources, ask questions, watch it grow.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-6 max-h-[80vh] overflow-y-auto scrollbar-hidden">
          <CreateEngramForm userId={userId} variant="modal" onCancel={onClose} />
        </div>
      </div>
    </div>
  )
}
