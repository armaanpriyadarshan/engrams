import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Sidebar } from "@/app/components/app/Sidebar"
import { TopBar } from "@/app/components/app/TopBar"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  const { data: engrams } = await supabase
    .from("engrams")
    .select("id, name, slug, accent_color, article_count, source_count")
    .order("created_at", { ascending: true })

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar engrams={engrams ?? []} profile={profile} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
