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
  const state = searchParams.get("state") // engram_id
  const error = searchParams.get("error")

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (error) {
      setStatus("error")
      setMessage(`Authorization denied: ${error}`)
      return
    }
    if (!code || !state) {
      setStatus("error")
      setMessage("No authorization code received.")
      return
    }

    const supabase = createClient()
    const redirectUri = `${window.location.origin}/app/${engramSlug}/settings/callback/${service}`

    supabase.functions.invoke("integration-auth", {
      body: {
        action: "callback",
        service,
        engram_id: state,
        redirect_uri: redirectUri,
        code,
      },
    }).then(({ data, error: fnError }) => {
      if (fnError || !data) {
        setStatus("error")
        setMessage("Failed to connect. Try again.")
      } else {
        setStatus("success")
        setMessage(`${service} connected.`)
        setTimeout(() => router.push(`/app/${engramSlug}/settings`), 1500)
      }
    })
  }, [code, error, state, service, engramSlug, router])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        {status === "loading" && (
          <p className="text-sm text-text-secondary">Connecting {service}...</p>
        )}
        {status === "success" && (
          <>
            <p className="text-sm text-confidence-high">{message}</p>
            <p className="mt-2 text-xs text-text-tertiary">Redirecting to settings...</p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-sm text-danger">{message}</p>
            <button
              onClick={() => router.push(`/app/${engramSlug}/settings`)}
              className="mt-4 text-xs font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120 cursor-pointer"
            >
              Back to settings
            </button>
          </>
        )}
      </div>
    </div>
  )
}
