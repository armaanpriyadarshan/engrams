"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function OAuthCallbackPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const service = params.service as string
  const engramSlug = params.engram as string
  const code = searchParams.get("code")
  const error = searchParams.get("error")
  const engramId = searchParams.get("state") || ""

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (error) {
      setStatus("error")
      setMessage(`Authorization denied: ${error}`)
      return
    }
    if (!code) {
      setStatus("error")
      setMessage("No authorization code received.")
      return
    }

    const redirectUri = `${window.location.origin}/app/${engramSlug}/settings/callback/${service}`
    const supabase = createClient()

    supabase.functions.invoke("manage-integration", {
      body: {
        action: "exchange-code",
        engram_id: engramId,
        service,
        code,
        redirect_uri: redirectUri,
      },
    }).then(({ data, error: fnError }) => {
      if (fnError || data?.error) {
        setStatus("error")
        setMessage(data?.error || "Failed to connect.")
      } else {
        setStatus("success")
        setMessage(`${service} connected.`)
        setTimeout(() => router.push(`/app/${engramSlug}`), 1500)
      }
    }).catch(() => {
      setStatus("error")
      setMessage("Connection failed.")
    })
  }, [code, error, service, engramSlug, engramId, router])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        {status === "loading" && (
          <p className="text-sm text-text-secondary">Connecting {service}...</p>
        )}
        {status === "success" && (
          <>
            <p className="text-sm text-confidence-high">{message}</p>
            <p className="mt-2 text-xs text-text-tertiary">Redirecting...</p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-sm text-danger">{message}</p>
            <button
              onClick={() => router.push(`/app/${engramSlug}`)}
              className="mt-4 text-xs font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120 cursor-pointer"
            >
              Back to engram
            </button>
          </>
        )}
      </div>
    </div>
  )
}
