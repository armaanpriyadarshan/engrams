import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import ArticleContent from "@/app/components/app/ArticleContent"

export default async function PublishedArticlePage({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>
}) {
  const { slug, articleSlug } = await params
  const supabase = await createClient()

  // Verify engram is published
  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", slug)
    .eq("visibility", "published")
    .single()

  if (!engram) notFound()

  const { data: article } = await supabase
    .from("articles")
    .select("*")
    .eq("engram_id", engram.id)
    .eq("slug", articleSlug)
    .single()

  if (!article) notFound()

  const { data: backlinks } = await supabase
    .from("articles")
    .select("slug, title")
    .eq("engram_id", engram.id)
    .contains("related_slugs", [articleSlug])

  return (
    <div className="max-w-[660px] mx-auto px-6 py-10 overflow-y-auto scrollbar-hidden h-full">
      <Link
        href={`/e/${slug}`}
        className="text-xs text-text-ghost hover:text-text-tertiary transition-colors duration-120 font-mono"
      >
        &larr; back to map
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
            <ArticleContent contentMd={article.content_md} engramSlug={slug} linkPrefix={`/e/${slug}`} />
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
                href={`/e/${slug}/article/${b.slug}`}
                className="block text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-120"
              >
                {b.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
