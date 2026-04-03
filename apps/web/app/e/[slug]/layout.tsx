import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"

export default async function PublishedLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("name, accent_color, visibility")
    .eq("slug", slug)
    .eq("visibility", "published")
    .single()

  if (!engram) notFound()

  return (
    <div className="min-h-dvh flex flex-col">
      <header
        className="h-11 shrink-0 border-b border-border flex items-center px-6 gap-4"
        style={{ borderTopColor: engram.accent_color ?? "#76808F", borderTopWidth: "2px", borderTopStyle: "solid" }}
      >
        <span className="font-heading text-sm text-text-emphasis">{engram.name}</span>
        <div className="flex-1" />
        <Link href="/" className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-150">
          Powered by Engrams
        </Link>
      </header>
      <main className="flex-1 relative overflow-hidden">
        {children}
      </main>
    </div>
  )
}
