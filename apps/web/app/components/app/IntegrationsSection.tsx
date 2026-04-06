"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"

interface ServiceStatus {
  service_name: string
  display_name: string
  description: string
  connected: boolean
  status: string | null
  last_sync_at: string | null
  last_sync_count: number | null
  error: string | null
  metadata: Record<string, unknown> | null
}

export default function IntegrationsSection({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.functions.invoke("manage-integration", {
      body: { action: "list-status", engram_id: engramId },
    })
    if (!error && data) setServices(data)
    setLoading(false)
  }, [engramId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const connect = async (service: string) => {
    const redirectUri = `${window.location.origin}/app/${engramSlug}/settings/callback/${service}`
    const supabase = createClient()
    const { data, error } = await supabase.functions.invoke("manage-integration", {
      body: { action: "get-auth-url", service, redirect_uri: redirectUri, state: engramId },
    })
    if (!error && data?.auth_url) {
      window.location.href = data.auth_url
    }
  }

  const sync = async (service: string) => {
    setSyncing(service)
    const supabase = createClient()
    await supabase.functions.invoke("manage-integration", {
      body: { action: "sync", engram_id: engramId, service },
    })
    await fetchStatus()
    setSyncing(null)
  }

  const disconnect = async (service: string) => {
    const supabase = createClient()
    await supabase.functions.invoke("manage-integration", {
      body: { action: "disconnect", engram_id: engramId, service },
    })
    fetchStatus()
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  if (loading) {
    return <p className="text-xs font-mono text-text-ghost">Loading integrations<span className="inline-flex w-4"><span className="animate-loading-dots" /></span></p>
  }

  return (
    <div className="max-w-[660px] mx-auto px-6 pt-28 pb-32" style={{ animation: "fade-in 300ms ease-out both" }}>
      <h2 className="font-heading text-sm text-text-emphasis mb-2">Connect</h2>
      <p className="text-xs text-text-tertiary mb-8">Sync knowledge from external services into this engram.</p>

      <div className="space-y-3">
        {services.map((svc) => (
          <div key={svc.service_name} className="border border-border p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-text-emphasis">{svc.display_name}</div>
                <div className="mt-1 text-xs text-text-tertiary">{svc.description}</div>
                {svc.connected && svc.metadata && (
                  <div className="mt-2 text-[10px] font-mono text-text-ghost">
                    {svc.metadata.username && `@${svc.metadata.username}`}
                    {svc.metadata.workspace_name && svc.metadata.workspace_name}
                    {svc.metadata.email && svc.metadata.email}
                  </div>
                )}
              </div>
              {svc.connected ? (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => sync(svc.service_name)}
                    disabled={syncing === svc.service_name}
                    className="text-[10px] font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120 cursor-pointer disabled:opacity-30"
                  >
                    {syncing === svc.service_name ? "Syncing..." : "Sync"}
                  </button>
                  <button
                    onClick={() => disconnect(svc.service_name)}
                    className="text-[10px] font-mono text-danger/70 hover:text-danger transition-colors duration-120 cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => connect(svc.service_name)}
                  className="text-[10px] font-mono text-text-secondary hover:text-text-emphasis border border-border hover:border-border-emphasis px-3 py-1.5 transition-colors duration-120 cursor-pointer shrink-0"
                >
                  Connect
                </button>
              )}
            </div>
            {svc.connected && (
              <div className="mt-3 flex items-center gap-3 text-[10px] font-mono text-text-ghost">
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
    </div>
  )
}
