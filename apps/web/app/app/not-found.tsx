import Link from "next/link"

export default function AppNotFound() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-heading text-2xl text-text-emphasis">Not found.</h1>
        <p className="mt-3 text-sm text-text-tertiary">The page you are looking for does not exist.</p>
        <Link href="/app" className="mt-6 inline-block text-xs font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-150">
          Back to engrams
        </Link>
      </div>
    </div>
  )
}
