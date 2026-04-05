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

      {/* Full-window expanded panel */}
      <div
        className="fixed inset-0 z-40"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          className="absolute inset-0 bg-void/80 backdrop-blur-sm"
          onClick={close}
        />
        <div
          className="absolute inset-0 flex items-stretch justify-center"
          style={{
            transform: isOpen ? "scale(1)" : "scale(0.97)",
            transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div className="w-full max-w-3xl h-full overflow-y-auto scrollbar-hidden relative">
            {/* Close button */}
            <div className="sticky top-0 z-10 flex justify-end p-4">
              <button
                onClick={close}
                className="bg-surface/80 backdrop-blur-md border border-border rounded-sm p-2 text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="px-6 pb-12">
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
