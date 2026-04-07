"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

export default function McpAuthPage() {
  const [status, setStatus] = useState<"checking" | "not-logged-in" | "generating" | "done" | "error">("checking")
  const [token, setToken] = useState("")
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const generate = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setStatus("not-logged-in")
        return
      }

      setStatus("generating")

      const { data, error: fnError } = await supabase.functions.invoke("mcp-auth", {
        body: { action: "create-token", access_token: session.access_token },
      })

      if (fnError || !data?.token) {
        setStatus("error")
        setError("Failed to generate token.")
        return
      }

      setToken(data.token)
      setStatus("done")
    }

    generate()
  }, [])

  const copyToken = () => {
    navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="max-w-lg w-full px-6">
        <h1 className="font-heading text-xl text-text-emphasis mb-4">Engrams MCP</h1>
        <p className="text-sm text-text-secondary mb-8">
          Connect AI tools like Claude Code and Cursor to your engrams.
        </p>

        {status === "checking" && (
          <p className="text-xs font-mono text-text-ghost">Checking authentication...</p>
        )}

        {status === "not-logged-in" && (
          <div>
            <p className="text-sm text-text-tertiary mb-4">Sign in to generate your API token.</p>
            <Link
              href="/login?next=/auth/mcp"
              className="inline-block bg-text-primary text-void px-5 py-2.5 text-sm font-medium hover:bg-text-emphasis transition-colors duration-120"
            >
              Sign in
            </Link>
          </div>
        )}

        {status === "generating" && (
          <p className="text-xs font-mono text-agent-active">Generating your API token...</p>
        )}

        {status === "done" && (
          <div>
            <p className="text-xs text-text-tertiary mb-3">Your API token (copy it now — it won't be shown again):</p>
            <div className="bg-surface border border-border-emphasis p-4 flex items-center gap-3">
              <code className="text-xs font-mono text-text-primary flex-1 break-all select-all">{token}</code>
              <button
                onClick={copyToken}
                className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer shrink-0"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Setup</h2>

              <div className="space-y-4">
                <div>
                  <p className="text-xs text-text-secondary mb-2">1. Set your environment variables:</p>
                  <div className="bg-surface border border-border p-3">
                    <code className="text-[11px] font-mono text-text-tertiary block">
                      export ENGRAMS_SUPABASE_URL=https://edrlhkcnkfsypdzffhle.supabase.co
                    </code>
                    <code className="text-[11px] font-mono text-text-tertiary block mt-1">
                      export ENGRAMS_API_TOKEN={token.slice(0, 12)}...
                    </code>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-text-secondary mb-2">2. Add to Claude Code:</p>
                  <div className="bg-surface border border-border p-3">
                    <code className="text-[11px] font-mono text-text-tertiary block">
                      claude mcp add --transport stdio engrams -- npx engrams-mcp
                    </code>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-text-secondary mb-2">3. Try it:</p>
                  <p className="text-xs text-text-tertiary">
                    "List my engrams" or "Feed this into my Coffee engram: ..."
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {status === "error" && (
          <p className="text-sm text-danger">{error}</p>
        )}
      </div>
    </div>
  )
}
