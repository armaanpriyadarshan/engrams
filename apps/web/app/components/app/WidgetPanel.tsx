"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"

interface PanelContextType {
  openId: string | null
  open: (id: string) => void
  close: () => void
  toggle: (id: string) => void
}

const PanelContext = createContext<PanelContextType>({
  openId: null,
  open: () => {},
  close: () => {},
  toggle: () => {},
})

export function usePanelContext() {
  return useContext(PanelContext)
}

export function WidgetPanelProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)

  const open = useCallback((id: string) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])
  const toggle = useCallback((id: string) => setOpenId(prev => prev === id ? null : id), [])

  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openId, close])

  return (
    <PanelContext.Provider value={{ openId, open, close, toggle }}>
      {children}
    </PanelContext.Provider>
  )
}

interface WidgetPanelProps {
  id: string
  origin: { top?: string; bottom?: string; left?: string; right?: string; width: string }
  preview: ReactNode
  children: ReactNode
  className?: string
}

export function WidgetPanel({ id, origin, preview, children, className }: WidgetPanelProps) {
  const { openId, toggle } = usePanelContext()
  const isOpen = openId === id
  const otherOpen = openId !== null && openId !== id

  // Collapsed: widget at its origin position/size
  // Expanded: fills the parent (inset 0, full size)
  const collapsed = {
    top: origin.top ?? "auto",
    bottom: origin.bottom ?? "auto",
    left: origin.left ?? "auto",
    right: origin.right ?? "auto",
    width: origin.width,
    height: "auto",
    borderRadius: "1px",
  }

  const expanded = {
    top: "0px",
    bottom: "0px",
    left: "0px",
    right: "0px",
    width: "100%",
    height: "100%",
    borderRadius: "0px",
  }

  const style = isOpen ? expanded : collapsed

  return (
    <div
      className={`absolute z-30 pointer-events-auto ${className ?? ""}`}
      onClick={() => { if (!isOpen) toggle(id) }}
      style={{
        ...style,
        cursor: isOpen ? "default" : "pointer",
        opacity: otherOpen ? 0 : 1,
        pointerEvents: otherOpen ? "none" : "auto",
        transition: "top 300ms cubic-bezier(0.16, 1, 0.3, 1), bottom 300ms cubic-bezier(0.16, 1, 0.3, 1), left 300ms cubic-bezier(0.16, 1, 0.3, 1), right 300ms cubic-bezier(0.16, 1, 0.3, 1), width 300ms cubic-bezier(0.16, 1, 0.3, 1), height 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out, border-radius 300ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Preview — visible when collapsed */}
      <div
        style={{
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? "none" : "auto",
          transition: "opacity 150ms ease-out",
          position: isOpen ? "absolute" : "relative",
        }}
      >
        {preview}
      </div>

      {/* Expanded content — visible when open */}
      <div
        className="overflow-y-auto scrollbar-hidden"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 200ms ease-out 100ms",
          height: isOpen ? "100%" : "0",
        }}
      >
        <div className="bg-surface/95 backdrop-blur-xl h-full">
          <div className="max-w-2xl mx-auto px-6 pt-6 pb-12">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
