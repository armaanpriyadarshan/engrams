import json
import hashlib
from datetime import datetime, timezone

import httpx
from openai import OpenAI

from core.config import settings
from core.database import get_supabase
from engine.prompts import COMPILER_SYSTEM, COMPILER_USER


def compile_source(source_id: str) -> dict:
    supabase = get_supabase()
    client = OpenAI(api_key=settings.openai_api_key)

    # 1. Read the source
    result = supabase.table("sources").select("*").eq("id", source_id).single().execute()
    source = result.data
    if not source:
        raise ValueError(f"Source {source_id} not found")

    engram_id = source["engram_id"]

    # 2. Get content
    content = source.get("content_md") or ""

    if source["source_type"] == "url" and source.get("source_url") and not content:
        try:
            import trafilatura
            resp = httpx.get(source["source_url"], headers={"User-Agent": "Engrams/1.0"}, timeout=30)
            content = trafilatura.extract(resp.text) or ""
            if content:
                content_hash = hashlib.sha256(content.encode()).hexdigest()
                supabase.table("sources").update({
                    "content_md": content[:50000],
                    "content_hash": content_hash,
                }).eq("id", source_id).execute()
        except Exception:
            supabase.table("sources").update({"status": "failed"}).eq("id", source_id).execute()
            raise

    if not content.strip():
        supabase.table("sources").update({"status": "failed"}).eq("id", source_id).execute()
        raise ValueError("No content to compile")

    truncated = content[:24000]

    # 3. Read existing article index
    articles_result = supabase.table("articles").select("slug, title, summary").eq("engram_id", engram_id).execute()
    existing = articles_result.data or []
    wiki_index = "\n".join(
        f"- {a['slug']}: {a['title']}{' — ' + a['summary'] if a.get('summary') else ''}"
        for a in existing
    ) or "(empty — this is the first source)"

    # 4. Create compilation run
    now = datetime.now(timezone.utc).isoformat()
    run_result = supabase.table("compilation_runs").insert({
        "engram_id": engram_id,
        "source_id": source_id,
        "trigger_type": "feed",
        "status": "running",
        "started_at": now,
    }).execute()
    run_id = run_result.data[0]["id"] if run_result.data else None

    # 5. Call OpenAI
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": COMPILER_SYSTEM},
                {"role": "user", "content": COMPILER_USER.format(
                    title=source.get("title") or "Untitled",
                    content=truncated,
                    wiki_index=wiki_index,
                )},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        result_data = json.loads(response.choices[0].message.content)
    except Exception as e:
        supabase.table("compilation_runs").update({
            "status": "failed",
            "log": {"error": str(e)},
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id).execute()
        supabase.table("sources").update({"status": "failed"}).eq("id", source_id).execute()
        raise

    # 6. Write articles
    articles_created = 0
    articles_updated = 0

    for article in result_data.get("articles", []):
        if article.get("action") == "update":
            existing_result = supabase.table("articles").select("id, source_ids, related_slugs").eq(
                "engram_id", engram_id
            ).eq("slug", article["slug"]).single().execute()

            if existing_result.data:
                ex = existing_result.data
                source_ids = list(set((ex.get("source_ids") or []) + [source_id]))
                related_slugs = list(set(
                    (ex.get("related_slugs") or []) +
                    [a["slug"] for a in result_data.get("articles", []) if a["slug"] != article["slug"]]
                ))
                supabase.table("articles").update({
                    "title": article["title"],
                    "summary": article.get("summary"),
                    "content_md": article["content_md"],
                    "confidence": article.get("confidence"),
                    "article_type": article.get("article_type"),
                    "tags": article.get("tags", []),
                    "source_ids": source_ids,
                    "related_slugs": related_slugs,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", ex["id"]).execute()
                articles_updated += 1
            else:
                article["action"] = "create"

        if article.get("action") == "create":
            related_slugs = [
                a["slug"] for a in result_data.get("articles", [])
                if a["slug"] != article["slug"]
            ]
            supabase.table("articles").insert({
                "engram_id": engram_id,
                "slug": article["slug"],
                "title": article["title"],
                "summary": article.get("summary"),
                "content_md": article["content_md"],
                "confidence": article.get("confidence", 0.5),
                "article_type": article.get("article_type", "concept"),
                "tags": article.get("tags", []),
                "source_ids": [source_id],
                "related_slugs": related_slugs,
            }).execute()
            articles_created += 1

    # 7. Write edges
    edges_created = 0
    for edge in result_data.get("edges", []):
        try:
            supabase.table("edges").insert({
                "engram_id": engram_id,
                "from_slug": edge["from_slug"],
                "to_slug": edge["to_slug"],
                "relation": edge.get("relation", "related"),
                "weight": edge.get("weight", 1.0),
            }).execute()
            edges_created += 1
        except Exception:
            pass

    # 8. Update compilation run
    supabase.table("compilation_runs").update({
        "status": "completed",
        "articles_created": articles_created,
        "articles_updated": articles_updated,
        "edges_created": edges_created,
        "log": {"articles": len(result_data.get("articles", [])), "edges": len(result_data.get("edges", []))},
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", run_id).execute()

    # 9. Update source status
    supabase.table("sources").update({"status": "compiled"}).eq("id", source_id).execute()

    # 10. Update engram article count
    count_result = supabase.table("articles").select("id", count="exact").eq("engram_id", engram_id).execute()
    supabase.table("engrams").update({
        "article_count": count_result.count or 0,
    }).eq("id", engram_id).execute()

    return {
        "articles_created": articles_created,
        "articles_updated": articles_updated,
        "edges_created": edges_created,
    }
