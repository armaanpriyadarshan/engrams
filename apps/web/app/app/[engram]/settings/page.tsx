import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import SettingsForm from "@/app/components/app/SettingsForm"

export default async function SettingsPage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("*")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  return (
    <div className="max-w-xl mx-auto px-6 py-10 overflow-y-auto h-full">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Settings</h1>
      <SettingsForm engram={engram} />
    </div>
  )
}
