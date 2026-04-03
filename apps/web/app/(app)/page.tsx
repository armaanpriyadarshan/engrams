import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function AppPage() {
  const supabase = await createClient()
  const { data: engrams } = await supabase
    .from("engrams")
    .select("slug")
    .order("created_at", { ascending: true })
    .limit(1)

  if (engrams && engrams.length > 0) {
    redirect(`/app/${engrams[0].slug}`)
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="text-text-secondary">Nothing here yet.</p>
        <p className="mt-2 text-sm text-text-tertiary">Form your first engram from the sidebar.</p>
      </div>
    </div>
  )
}
