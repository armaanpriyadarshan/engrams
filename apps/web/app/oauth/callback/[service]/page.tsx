"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function OAuthCallbackPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const service = params.service as string
  const code = searchParams.get("code")
  const state = searchParams.get("state") // "{engram_id}|{engram_slug}"
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
      setMessage("Missing authorization code.")
      return
    }

    const [engramId, engramSlug] = state.split("|")
    if (!engramId || !engramSlug) {
      setStatus("error")
      setMessage("Invalid state.")
      return
    }

    const supabase = createClient()
    const redirectUri = `${window.location.origin}/oauth/callback/${service}`

    supabase.functions.invoke("integration-auth", {
      body: {
        action: "callback",
        service,
        engram_id: engramId,
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
        setTimeout(() => router.push(`/app/${engramSlug}`), 1500)
      }
    })
  }, [code, error, state, service, router])

  return (
    <div className="h-full flex items-center justify-center min-h-screen">
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
              onClick={() => router.push("/app")}
              className="mt-4 text-xs font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120 cursor-pointer"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}
