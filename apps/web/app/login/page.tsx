"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push("/app")
    router.refresh()
  }

  const handleGoogleLogin = async () => {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <h1 className="font-heading text-2xl text-text-emphasis">Sign in to your account</h1>
      <p className="mt-3 text-sm text-text-secondary">Your knowledge, compiled.</p>

      <form onSubmit={handleEmailLogin} className="mt-10 w-full max-w-xs space-y-4">
        <div>
          <label className="block text-xs text-text-tertiary mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-surface border border-border-emphasis px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
          />
        </div>
        <div>
          <label className="block text-xs text-text-tertiary mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-surface border border-border-emphasis px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-text-primary text-void py-2.5 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-6 flex items-center gap-3 w-full max-w-xs">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-text-ghost uppercase tracking-widest">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <button
        onClick={handleGoogleLogin}
        className="mt-6 w-full max-w-xs flex items-center justify-center gap-3 border border-border-emphasis px-4 py-2.5 text-xs text-text-primary hover:border-text-tertiary hover:text-text-emphasis transition-colors duration-120 cursor-pointer"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Continue with Google
      </button>

      <p className="mt-8 text-xs text-text-tertiary">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-text-secondary hover:text-text-emphasis transition-colors duration-120">
          Sign up
        </Link>
      </p>
    </div>
  )
}
