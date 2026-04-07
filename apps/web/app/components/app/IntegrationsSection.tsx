"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

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

const AVAILABLE_SERVICES = [
  { service_name: "github", display_name: "GitHub", description: "Import READMEs, docs, and issues from repositories." },
  { service_name: "notion", display_name: "Notion", description: "Import pages and databases from your workspace." },
  { service_name: "google_drive", display_name: "Google Drive", description: "Import documents, spreadsheets, and PDFs." },
]

export default function IntegrationsSection({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("integrations")
      .select("service_name, status, last_sync_at, last_sync_count, error_log")
      .eq("engram_id", engramId)

    const connected = new Map((data ?? []).map(d => [d.service_name, d]))

    setServices(AVAILABLE_SERVICES.map(svc => ({
      ...svc,
      connected: connected.has(svc.service_name),
      status: connected.get(svc.service_name)?.status ?? null,
      last_sync_at: connected.get(svc.service_name)?.last_sync_at ?? null,
      last_sync_count: connected.get(svc.service_name)?.last_sync_count ?? null,
      error: connected.get(svc.service_name)?.error_log ?? null,
    })))
  }, [engramId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const connect = async (service: string) => {
    const supabase = createClient()
    const redirectUri = `${window.location.origin}/oauth/callback/${service}`
    const { data } = await supabase.functions.invoke("integration-auth", {
      body: {
        action: "auth-url",
        service,
        engram_id: engramId,
        redirect_uri: redirectUri,
        state: `${engramId}|${engramSlug}`,
      },
    })
    if (data?.auth_url) window.location.href = data.auth_url
  }

  const sync = async (service: string) => {
    setSyncing(service)
    const supabase = createClient()
    const { data: integ } = await supabase
      .from("integrations")
      .select("id")
      .eq("engram_id", engramId)
      .eq("service_name", service)
      .single()

    if (integ) {
      await supabase.functions.invoke("sync-integration", {
        body: { integration_id: integ.id },
      })
    }
    setTimeout(() => { fetchStatus(); setSyncing(null) }, 3000)
  }

  const disconnect = async (service: string) => {
    const supabase = createClient()
    await supabase
      .from("integrations")
      .delete()
      .eq("engram_id", engramId)
      .eq("service_name", service)
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

  return (
    <div>
      <label className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest">Integrations</label>
      <p className="mt-2 text-xs text-text-tertiary mb-4">Connect services to automatically sync knowledge into this engram.</p>
      <div className="space-y-2">
        {services.map((svc) => (
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
                  className="text-[10px] font-mono text-text-secondary hover:text-text-emphasis border border-border hover:border-border-emphasis px-3 py-1.5 transition-colors duration-120 cursor-pointer"
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
                {svc.error && <span className="text-danger truncate max-w-[200px]">{svc.error}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Tools */}
      <div className="mt-6">
        <label className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest">AI Tools</label>
        <div className="mt-3">
          <Link
            href="/auth/mcp"
            className="block border border-border hover:border-border-emphasis p-4 transition-colors duration-120"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-text-emphasis">Claude Code / Cursor MCP</div>
                <div className="mt-1 text-[10px] text-text-tertiary">Connect AI coding tools to your engrams via Model Context Protocol.</div>
              </div>
              <span className="text-[10px] font-mono text-text-ghost shrink-0">Setup &rarr;</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
