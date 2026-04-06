import Link from "next/link"

export default function PublishedNotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-heading text-2xl text-text-emphasis">Not found.</h1>
        <p className="mt-3 text-sm text-text-tertiary">This engram does not exist or is private.</p>
        <Link href="/" className="mt-6 inline-block text-xs font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120">
          Go home
        </Link>
      </div>
    </div>
  )
}
