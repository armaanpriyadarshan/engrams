import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import ArticleContent from "@/app/components/app/ArticleContent"

export default async function ArticlePage({ params }: { params: Promise<{ engram: string; slug: string }> }) {
  const { engram: engramSlug, slug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  const { data: article } = await supabase
    .from("articles")
    .select("*")
    .eq("engram_id", engram.id)
    .eq("slug", slug)
    .single()

  if (!article) notFound()

  // Get backlinks — articles that reference this one
  const { data: backlinks } = await supabase
    .from("articles")
    .select("slug, title")
    .eq("engram_id", engram.id)
    .contains("related_slugs", [slug])

  return (
    <div className="max-w-[660px] mx-auto px-6 py-10 h-full overflow-y-auto scrollbar-hidden">
      <Link
        href={`/app/${engramSlug}`}
        className="text-xs text-text-ghost hover:text-text-tertiary transition-colors duration-150 font-mono"
      >
        &larr; back
      </Link>

      <article className="mt-8">
        <h1 className="font-heading text-2xl text-text-emphasis leading-tight">{article.title}</h1>

        {article.summary && (
          <p className="mt-3 text-sm text-text-secondary leading-relaxed">{article.summary}</p>
        )}

        <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-text-ghost">
          <span>{article.article_type}</span>
          <span>&middot;</span>
          <span>confidence {((article.confidence ?? 0) * 100).toFixed(0)}%</span>
          {article.tags && article.tags.length > 0 && (
            <>
              <span>&middot;</span>
              {article.tags.map((tag: string) => (
                <span key={tag}>{tag}</span>
              ))}
            </>
          )}
        </div>

        <div className="mt-8 border-t border-border pt-8">
          <div className="prose-engram leading-[1.65] text-[15px] text-text-primary">
            <ArticleContent contentMd={article.content_md} engramSlug={engramSlug} />
          </div>
        </div>
      </article>

      {backlinks && backlinks.length > 0 && (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Backlinks</h2>
          <div className="space-y-2">
            {backlinks.map((b) => (
              <Link
                key={b.slug}
                href={`/app/${engramSlug}/article/${b.slug}`}
                className="block text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-150"
              >
                {b.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {article.source_ids && article.source_ids.length > 0 && (
        <div className="mt-8 border-t border-border pt-8">
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Sources</h2>
          <p className="text-xs text-text-ghost font-mono">{article.source_ids.length} source{article.source_ids.length !== 1 ? "s" : ""}</p>
        </div>
      )}
    </div>
  )
}
