"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"

export default function OAuthCallbackPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const service = params.service as string
  const engramSlug = params.engram as string
  const code = searchParams.get("code")
  const error = searchParams.get("error")

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

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    const redirectUri = `${window.location.origin}/app/${engramSlug}/settings/callback/${service}`

    fetch(`${apiUrl}/api/engrams/${searchParams.get("state") || ""}/integrations/${service}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
      .then(async (resp) => {
        if (resp.ok) {
          setStatus("success")
          setMessage(`${service} connected.`)
          setTimeout(() => router.push(`/app/${engramSlug}/settings`), 1500)
        } else {
          const data = await resp.json().catch(() => ({}))
          setStatus("error")
          setMessage(data.detail || "Failed to connect.")
        }
      })
      .catch(() => {
        setStatus("error")
        setMessage("Could not reach the API server.")
      })
  }, [code, error, service, engramSlug, searchParams, router])

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
              className="mt-4 text-xs font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-150 cursor-pointer"
            >
              Back to settings
            </button>
          </>
        )}
      </div>
    </div>
  )
}
