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

  const collapsed = {
    top: origin.top ?? "auto",
    bottom: origin.bottom ?? "auto",
    left: origin.left ?? "auto",
    right: origin.right ?? "auto",
    width: origin.width,
    maxHeight: "auto",
  }

  const expanded = {
    top: "0px",
    bottom: "0px",
    left: "0px",
    right: "0px",
    width: "100%",
    maxHeight: "100%",
  }

  const style = isOpen ? expanded : collapsed
  const t = "300ms cubic-bezier(0.16, 1, 0.3, 1)"

  return (
    <div
      className={`absolute z-30 pointer-events-auto bg-surface/80 backdrop-blur-md border border-border rounded-sm ${className ?? ""}`}
      onClick={() => { if (!isOpen) toggle(id) }}
      style={{
        ...style,
        cursor: isOpen ? "default" : "pointer",
        opacity: otherOpen ? 0 : 1,
        pointerEvents: otherOpen ? "none" : "auto",
        overflow: "hidden",
        transition: `top ${t}, bottom ${t}, left ${t}, right ${t}, width ${t}, max-height ${t}, opacity 180ms ease-out, border-radius ${t}`,
        borderRadius: isOpen ? "0px" : "1px",
      }}
    >
      {/* Preview — visible when collapsed */}
      <div
        style={{
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? "none" : "auto",
          transition: "opacity 120ms ease-out",
          position: isOpen ? "absolute" : "relative",
          top: 0,
          left: 0,
          right: 0,
        }}
      >
        {preview}
      </div>

      {/* Expanded content — fades and slides in */}
      {isOpen && (
        <div
          className="h-full overflow-y-auto scrollbar-hidden"
        >
          <div className="max-w-2xl mx-auto px-6 pt-5 pb-12">
            <div
              style={{
                animation: "panel-content-in 400ms cubic-bezier(0.16, 1, 0.3, 1) both",
              }}
            >
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
