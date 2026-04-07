import { redirect } from "next/navigation"

// The sources experience lives entirely inside the Sources widget on the
// main engram page. This route just redirects there with a query param
// that auto-opens the widget.
export default async function SourcesPage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram } = await params
  redirect(`/app/${engram}?widget=sources`)
}
