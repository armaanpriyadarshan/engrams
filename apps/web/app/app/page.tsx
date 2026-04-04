import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import WelcomeScreen from "@/app/components/app/WelcomeScreen"

export default async function AppPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: engrams } = await supabase
    .from("engrams")
    .select("slug")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)

  if (engrams && engrams.length > 0) {
    redirect(`/app/${engrams[0].slug}`)
  }

  return <WelcomeScreen userId={user.id} />
}
