"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"

interface PanelContextType {
  openId: string | null
  open: (id: string) => void
  close: () => void
}

const PanelContext = createContext<PanelContextType>({
  openId: null,
  open: () => {},
  close: () => {},
})

export function usePanelContext() {
  return useContext(PanelContext)
}

export function WidgetPanelProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)

  const open = useCallback((id: string) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])

  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openId, close])

  return (
    <PanelContext.Provider value={{ openId, open, close }}>
      {children}
    </PanelContext.Provider>
  )
}

interface WidgetPanelProps {
  id: string
  preview: ReactNode
  children: ReactNode
  className?: string
}

export function WidgetPanel({ id, preview, children, className }: WidgetPanelProps) {
  const { openId, open, close } = usePanelContext()
  const cardRef = useRef<HTMLDivElement>(null)
  const isMe = openId === id
  const otherOpen = openId !== null && !isMe

  const [phase, setPhase] = useState<null | "opening" | "open" | "closing">(null)
  const [rect, setRect] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const [target, setTarget] = useState({ top: 0, left: 0, width: 0, height: 0 })

  const getTarget = () => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(520, vw - 48)
    return { top: vh * 0.08, left: (vw - w) / 2, width: w, height: vh * 0.84 }
  }

  const handleOpen = () => {
    if (!cardRef.current || phase) return
    const r = cardRef.current.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    setTarget(getTarget())
    setPhase("opening")
    open(id)
    // Animate to target next frame
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setPhase("open")
    }))
  }

  const handleClose = useCallback(() => {
    if (!cardRef.current) { close(); setPhase(null); return }
    const r = cardRef.current.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    setPhase("closing")
    setTimeout(() => { setPhase(null); close() }, 200)
  }, [close])

  // If provider closed us externally (Escape), trigger close animation
  useEffect(() => {
    if (!isMe && phase === "open") {
      if (!cardRef.current) { setPhase(null); return }
      const r = cardRef.current.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      setPhase("closing")
      setTimeout(() => setPhase(null), 200)
    }
  }, [isMe])

  const isVisible = phase !== null

  // Box position: opening goes card→target, open=target, closing goes target→card
  const box = (() => {
    if (phase === "opening") return rect // start at card, will transition to target
    if (phase === "open") return target
    if (phase === "closing") return rect
    return rect
  })()

  // Transition: opening=250ms to target, closing=200ms to card
  const transition = phase === "opening"
    ? "none" // set card rect with no transition, then open phase applies target
    : phase === "open"
      ? "top 250ms ease-out, left 250ms ease-out, width 250ms ease-out, height 250ms ease-out"
      : phase === "closing"
        ? "top 200ms ease-out, left 200ms ease-out, width 200ms ease-out, height 200ms ease-out"
        : "none"

  // For opening: we set card rect first (no transition), then on "open" phase we set target with transition
  const displayBox = phase === "open" ? target : box

  const previewVisible = phase === null || phase === "opening" || phase === "closing"
  const contentVisible = phase === "open"

  return (
    <>
      {/* Card — stays in DOM for layout, hidden when modal is showing */}
      <div
        ref={cardRef}
        className={`bg-surface border border-border rounded-sm ${className ?? ""}`}
        onClick={handleOpen}
        style={{
          cursor: "pointer",
          visibility: isVisible ? "hidden" : "visible",
          opacity: otherOpen ? 0 : 1,
          pointerEvents: otherOpen ? "none" : "auto",
          transition: "opacity 180ms ease-out",
        }}
      >
        {preview}
      </div>

      {/* Backdrop */}
      {isVisible && (
        <div
          className="fixed inset-0 z-40"
          onClick={handleClose}
          style={{
            backgroundColor: "rgba(5,5,5,0.6)",
            opacity: phase === "closing" ? 0 : phase === "opening" ? 0 : 1,
            transition: phase === "closing" ? "opacity 200ms ease-out" : "opacity 250ms ease-out",
          }}
        />
      )}

      {/* Modal — interpolates from card rect to centered target */}
      {isVisible && (
        <div
          className="fixed z-50 bg-surface border border-border overflow-hidden"
          style={{
            top: displayBox.top,
            left: displayBox.left,
            width: displayBox.width,
            height: displayBox.height,
            transition,
            borderRadius: "1px",
          }}
        >
          {/* Preview — visible during open/close morph, fades out 0-100ms */}
          <div
            style={{
              opacity: previewVisible ? 1 : 0,
              transition: "opacity 100ms ease-out",
              position: "absolute",
              top: 0, left: 0, right: 0,
              pointerEvents: "none",
            }}
          >
            {preview}
          </div>

          {/* Full content — fades in 100-250ms */}
          <div
            className="overflow-y-auto scrollbar-hidden absolute inset-0"
            style={{
              opacity: contentVisible ? 1 : 0,
              transition: contentVisible ? "opacity 150ms ease-out 100ms" : "opacity 80ms ease-out",
              pointerEvents: contentVisible ? "auto" : "none",
            }}
          >
            <div className="px-6 pt-5 pb-10">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
