import hashlib
import asyncio
from datetime import datetime, timezone

from workers.celery_app import celery
from engine.compiler import compile_source
from core.database import get_supabase


@celery.task(name="compile_source", bind=True, max_retries=2)
def compile_source_task(self, source_id: str):
    try:
        result = compile_source(source_id)
        return result
    except Exception as exc:
        raise self.retry(exc=exc, countdown=10)


@celery.task(name="sync_integration", bind=True, max_retries=3)
def sync_integration_task(self, integration_id: str):
    try:
        supabase = get_supabase()

        # Load integration record
        result = supabase.table("integrations").select("*").eq("id", integration_id).single().execute()
        integration_data = result.data
        if not integration_data:
            raise ValueError(f"Integration {integration_id} not found")

        service_name = integration_data["service_name"]
        engram_id = integration_data["engram_id"]
        access_token = integration_data["access_token"]
        config = integration_data.get("config") or {}
        last_sync = integration_data.get("last_sync_at")

        # Instantiate integration
        from integrations.registry import get_integration
        integration = get_integration(service_name)

        # Fetch sources
        sources = asyncio.get_event_loop().run_until_complete(
            integration.fetch_sources(access_token, config, since=last_sync)
        )

        # Insert sources and trigger compilation
        count = 0
        for src in sources:
            # Dedup by content hash
            content = src.content_md or ""
            content_hash = hashlib.sha256(content.encode()).hexdigest() if content else None

            if content_hash:
                existing = supabase.table("sources").select("id").eq(
                    "engram_id", engram_id
                ).eq("content_hash", content_hash).execute()
                if existing.data:
                    continue

            # Insert source
            source_result = supabase.table("sources").insert({
                "engram_id": engram_id,
                "source_type": src.source_type,
                "source_url": src.source_url,
                "content_md": src.content_md,
                "content_hash": content_hash,
                "title": src.title,
                "origin_service": src.origin_service or service_name,
                "status": "pending",
                "metadata": src.metadata or {},
            }).execute()

            if source_result.data:
                source_id = source_result.data[0]["id"]
                compile_source_task.delay(source_id)
                count += 1

        # Update integration record
        now = datetime.now(timezone.utc).isoformat()
        supabase.table("integrations").update({
            "last_sync_at": now,
            "last_sync_count": count,
            "error_log": None,
        }).eq("id", integration_id).execute()

        # Update engram source count
        source_count = supabase.table("sources").select("id", count="exact").eq("engram_id", engram_id).execute()
        supabase.table("engrams").update({
            "source_count": source_count.count or 0,
        }).eq("id", engram_id).execute()

        return {"sources_synced": count}

    except Exception as exc:
        # Log error to integration record
        try:
            supabase = get_supabase()
            supabase.table("integrations").update({
                "error_log": str(exc),
                "status": "error",
            }).eq("id", integration_id).execute()
        except Exception:
            pass
        raise self.retry(exc=exc, countdown=30)
