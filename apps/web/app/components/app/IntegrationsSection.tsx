"use client"

import { useState, useEffect, useCallback } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface ServiceStatus {
  service_name: string
  display_name: string
  description: string
  connected: boolean
  status: string | null
  last_sync_at: string | null
  last_sync_count: number | null
  error: string | null
}

export default function IntegrationsSection({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${API_URL}/api/engrams/${engramId}/integrations`)
      if (resp.ok) {
        setServices(await resp.json())
      }
    } catch {
      // API not reachable — show fallback
    }
    setLoading(false)
  }, [engramId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const connect = async (service: string) => {
    const redirectUri = `${window.location.origin}/app/${engramSlug}/settings/callback/${service}`
    try {
      const resp = await fetch(`${API_URL}/api/engrams/${engramId}/integrations/${service}/auth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uri: redirectUri, state: engramId }),
      })
      if (resp.ok) {
        const { auth_url } = await resp.json()
        window.location.href = auth_url
      }
    } catch {
      // API not reachable
    }
  }

  const sync = async (service: string) => {
    setSyncing(service)
    try {
      await fetch(`${API_URL}/api/engrams/${engramId}/integrations/${service}/sync`, { method: "POST" })
      // Refresh status after a delay
      setTimeout(() => { fetchStatus(); setSyncing(null) }, 2000)
    } catch {
      setSyncing(null)
    }
  }

  const disconnect = async (service: string) => {
    await fetch(`${API_URL}/api/engrams/${engramId}/integrations/${service}`, { method: "DELETE" })
    fetchStatus()
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  const fallbackServices = [
    { service_name: "github", display_name: "GitHub", description: "Import READMEs, docs, and issues from repositories." },
    { service_name: "notion", display_name: "Notion", description: "Import pages and databases from your workspace." },
    { service_name: "google_drive", display_name: "Google Drive", description: "Import documents, spreadsheets, and PDFs." },
  ]

  const displayServices = services.length > 0 ? services : fallbackServices.map(s => ({
    ...s, connected: false, status: null, last_sync_at: null, last_sync_count: null, error: null,
  }))

  return (
    <div>
      <label className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest">Integrations</label>
      <p className="mt-2 text-xs text-text-tertiary mb-4">Connect services to automatically sync knowledge into this engram.</p>
      <div className="space-y-2">
        {displayServices.map((svc) => (
          <div key={svc.service_name} className="border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-text-emphasis">{svc.display_name}</div>
                <div className="mt-1 text-[10px] text-text-tertiary">{svc.description}</div>
              </div>
              {svc.connected ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => sync(svc.service_name)}
                    disabled={syncing === svc.service_name}
                    className="text-[10px] font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-150 cursor-pointer disabled:opacity-30"
                  >
                    {syncing === svc.service_name ? "Syncing..." : "Sync"}
                  </button>
                  <button
                    onClick={() => disconnect(svc.service_name)}
                    className="text-[10px] font-mono text-danger/70 hover:text-danger transition-colors duration-150 cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => connect(svc.service_name)}
                  className="text-[10px] font-mono text-text-secondary hover:text-text-emphasis border border-border hover:border-border-emphasis px-3 py-1.5 transition-colors duration-150 cursor-pointer"
                >
                  Connect
                </button>
              )}
            </div>
            {svc.connected && (
              <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-text-ghost">
                <span className={`w-1.5 h-1.5 rounded-full ${svc.status === "connected" ? "bg-confidence-high" : svc.status === "error" ? "bg-danger" : "bg-text-ghost"}`} />
                <span>{svc.status}</span>
                {svc.last_sync_at && <span>Last sync: {formatTime(svc.last_sync_at)}</span>}
                {svc.last_sync_count != null && <span>{svc.last_sync_count} sources</span>}
                {svc.error && <span className="text-danger">{svc.error}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {loading && services.length === 0 && (
        <p className="mt-3 text-[10px] font-mono text-text-ghost">
          Checking API connection...
        </p>
      )}
    </div>
  )
}
