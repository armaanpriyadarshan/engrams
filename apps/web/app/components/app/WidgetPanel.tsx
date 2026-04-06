"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react"

interface PanelContextType {
  openId: string | null
  open: (id: string) => void
  close: () => void
  registerCard: (id: string, ref: RefObject<HTMLDivElement | null>) => void
  getTargetRect: () => { top: number; left: number; width: number; height: number }
}

const PanelContext = createContext<PanelContextType>({
  openId: null,
  open: () => {},
  close: () => {},
  registerCard: () => {},
  getTargetRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
})

export function usePanelContext() {
  return useContext(PanelContext)
}

export function WidgetPanelProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const cardsRef = useRef<Map<string, RefObject<HTMLDivElement | null>>>(new Map())

  const open = useCallback((id: string) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])

  const registerCard = useCallback((id: string, ref: RefObject<HTMLDivElement | null>) => {
    cardsRef.current.set(id, ref)
  }, [])

  const getTargetRect = useCallback(() => {
    const vh = window.innerHeight
    let minLeft = Infinity
    let maxRight = -Infinity
    let minTop = Infinity

    cardsRef.current.forEach((ref) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width === 0) return
      if (r.left < minLeft) minLeft = r.left
      if (r.right > maxRight) maxRight = r.right
      if (r.top < minTop) minTop = r.top
    })

    // Fallback if no cards found
    if (minLeft === Infinity || maxRight === -Infinity) {
      const vw = window.innerWidth
      const w = Math.min(520, vw - 48)
      return { top: vh * 0.08, left: (vw - w) / 2, width: w, height: vh * 0.84 }
    }

    return {
      top: minTop,
      left: minLeft,
      width: maxRight - minLeft,
      height: vh - minTop - 12,
    }
  }, [])

  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openId, close])

  return (
    <PanelContext.Provider value={{ openId, open, close, registerCard, getTargetRect }}>
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
  const { openId, open, close, registerCard, getTargetRect } = usePanelContext()
  const cardRef = useRef<HTMLDivElement>(null)
  const isMe = openId === id
  const otherOpen = openId !== null && !isMe

  const [phase, setPhase] = useState<null | "opening" | "open" | "closing">(null)
  const [rect, setRect] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const [target, setTarget] = useState({ top: 0, left: 0, width: 0, height: 0 })

  // Register this card with the provider
  useEffect(() => {
    registerCard(id, cardRef)
  }, [id, registerCard])

  const handleOpen = () => {
    if (!cardRef.current || phase) return
    const r = cardRef.current.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    setTarget(getTargetRect())
    setPhase("opening")
    open(id)
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

  const displayBox = phase === "open" ? target : rect

  const transition = phase === "open"
    ? "top 250ms ease-out, left 250ms ease-out, width 250ms ease-out, height 250ms ease-out"
    : phase === "closing"
      ? "top 200ms ease-out, left 200ms ease-out, width 200ms ease-out, height 200ms ease-out"
      : "none"

  const previewVisible = phase === null || phase === "opening" || phase === "closing"
  const contentVisible = phase === "open"

  return (
    <>
      {/* Card in flow */}
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
            opacity: phase === "closing" || phase === "opening" ? 0 : 1,
            transition: phase === "closing" ? "opacity 200ms ease-out" : "opacity 250ms ease-out",
          }}
        />
      )}

      {/* Modal — morphs from card rect to target rect */}
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
          {/* Preview fades out 0-100ms */}
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

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
            style={{
              opacity: contentVisible ? 1 : 0,
              transition: "opacity 150ms ease-out 150ms",
              pointerEvents: contentVisible ? "auto" : "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Full content fades in 100-250ms */}
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
