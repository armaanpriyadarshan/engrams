import hashlib
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from core.database import get_supabase
from integrations.registry import get_integration, list_services
from workers.tasks import sync_integration_task

router = APIRouter()


@router.get("/{engram_id}/integrations")
async def list_integrations(engram_id: str):
    supabase = get_supabase()
    available = list_services()

    # Get connected integrations for this engram
    result = supabase.table("integrations").select(
        "service_name, status, last_sync_at, last_sync_count, config, metadata, error_log"
    ).eq("engram_id", engram_id).execute()
    connected = {i["service_name"]: i for i in (result.data or [])}

    return [
        {
            **svc,
            "connected": svc["service_name"] in connected,
            "status": connected.get(svc["service_name"], {}).get("status"),
            "last_sync_at": connected.get(svc["service_name"], {}).get("last_sync_at"),
            "last_sync_count": connected.get(svc["service_name"], {}).get("last_sync_count"),
            "error": connected.get(svc["service_name"], {}).get("error_log"),
        }
        for svc in available
    ]


class AuthUrlRequest(BaseModel):
    redirect_uri: str
    state: Optional[str] = None


@router.post("/{engram_id}/integrations/{service}/auth-url")
async def get_auth_url(engram_id: str, service: str, body: AuthUrlRequest):
    try:
        integration = get_integration(service)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service}")

    url = integration.get_auth_url(
        redirect_uri=body.redirect_uri,
        state=body.state or engram_id,
    )
    return {"auth_url": url}


class CallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/{engram_id}/integrations/{service}/callback")
async def oauth_callback(engram_id: str, service: str, body: CallbackRequest):
    try:
        integration = get_integration(service)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service}")

    # Exchange code for tokens
    tokens = await integration.exchange_code(body.code, body.redirect_uri)

    supabase = get_supabase()

    # Upsert integration record
    supabase.table("integrations").upsert({
        "engram_id": engram_id,
        "service_name": service,
        "status": "connected",
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token"),
        "token_expires_at": tokens.get("expires_at"),
        "metadata": tokens.get("metadata", {}),
        "config": tokens.get("default_config", {}),
        "error_log": None,
    }, on_conflict="engram_id,service_name").execute()

    return {"status": "connected", "service": service}


@router.post("/{engram_id}/integrations/{service}/sync")
async def trigger_sync(engram_id: str, service: str):
    supabase = get_supabase()

    result = supabase.table("integrations").select("id, status").eq(
        "engram_id", engram_id
    ).eq("service_name", service).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Integration not connected")

    if result.data["status"] != "connected":
        raise HTTPException(status_code=400, detail=f"Integration status: {result.data['status']}")

    sync_integration_task.delay(result.data["id"])
    return {"status": "sync_queued"}


class ConfigUpdate(BaseModel):
    config: dict


@router.put("/{engram_id}/integrations/{service}/config")
async def update_config(engram_id: str, service: str, body: ConfigUpdate):
    supabase = get_supabase()
    supabase.table("integrations").update({
        "config": body.config,
    }).eq("engram_id", engram_id).eq("service_name", service).execute()
    return {"status": "updated"}


@router.delete("/{engram_id}/integrations/{service}")
async def disconnect(engram_id: str, service: str):
    supabase = get_supabase()
    supabase.table("integrations").delete().eq(
        "engram_id", engram_id
    ).eq("service_name", service).execute()
    return {"status": "disconnected"}
