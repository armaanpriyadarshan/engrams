import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/app"
  const oauthError = searchParams.get("error")
  const oauthErrorDescription = searchParams.get("error_description")

  if (oauthError) {
    console.error("[auth/callback] OAuth provider error:", oauthError, oauthErrorDescription)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}&desc=${encodeURIComponent(oauthErrorDescription ?? "")}`)
  }

  if (!code) {
    console.error("[auth/callback] No code parameter in callback URL")
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message, error.code, error.status)
    return NextResponse.redirect(`${origin}/login?error=exchange&msg=${encodeURIComponent(error.message)}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
