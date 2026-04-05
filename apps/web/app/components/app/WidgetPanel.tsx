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
  side: "left" | "right"
  preview: ReactNode
  children: ReactNode
  previewClassName?: string
}

export function WidgetPanel({ id, side, preview, children, previewClassName }: WidgetPanelProps) {
  const { openId, toggle, close } = usePanelContext()
  const isOpen = openId === id
  const anyOpen = openId !== null

  return (
    <>
      {/* Preview widget — clicking anywhere opens */}
      <div
        className={previewClassName}
        onClick={() => toggle(id)}
        style={{
          opacity: anyOpen ? 0 : 1,
          pointerEvents: anyOpen ? "none" : "auto",
          transition: "opacity 180ms ease-out",
          cursor: "pointer",
        }}
      >
        {preview}
      </div>

      {/* Expanded panel — slides from edge, fills height */}
      <div
        className={`absolute top-0 ${side === "left" ? "left-0" : "right-0"} h-full z-40`}
        style={{
          width: isOpen ? "380px" : "0px",
          pointerEvents: isOpen ? "auto" : "none",
          transition: "width 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          className={`h-full bg-surface/95 backdrop-blur-xl ${side === "left" ? "border-r" : "border-l"} border-border overflow-y-auto scrollbar-hidden`}
          style={{
            opacity: isOpen ? 1 : 0,
            transform: isOpen ? "translateX(0)" : `translateX(${side === "left" ? "-12px" : "12px"})`,
            transition: "opacity 200ms ease-out, transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div className="px-5 pt-4 pb-8">
            {children}
          </div>
        </div>
      </div>
    </>
  )
}
