import hashlib
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

from core.database import get_supabase
from engine.parser import parse_file
from workers.tasks import compile_source_task

router = APIRouter()


@router.post("/{engram_id}/feed")
async def feed_source(
    engram_id: str,
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    text: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
):
    supabase = get_supabase()

    # Verify engram exists
    engram_result = supabase.table("engrams").select("id").eq("id", engram_id).single().execute()
    if not engram_result.data:
        raise HTTPException(status_code=404, detail="Engram not found")

    source_type = "text"
    content_md = None
    source_url = None
    source_title = title

    if file:
        # File upload
        content_bytes = await file.read()
        content_md = parse_file(content_bytes, file.filename or "file.txt")
        source_type = "file"
        source_title = source_title or (file.filename.rsplit(".", 1)[0] if file.filename else "Uploaded file")

    elif url:
        # URL source
        source_type = "url"
        source_url = url.strip()
        source_title = source_title or source_url

    elif text:
        # Text source
        source_type = "text"
        content_md = text.strip()
        source_title = source_title or content_md[:80]

    else:
        raise HTTPException(status_code=400, detail="Provide file, url, or text")

    # Compute content hash for dedup
    content_hash = None
    if content_md:
        content_hash = hashlib.sha256(content_md.encode()).hexdigest()

    # Insert source
    source_result = supabase.table("sources").insert({
        "engram_id": engram_id,
        "source_type": source_type,
        "source_url": source_url,
        "content_md": content_md,
        "content_hash": content_hash,
        "title": source_title,
        "status": "pending",
    }).execute()

    source_id = source_result.data[0]["id"]

    # Increment source count
    supabase.rpc("increment_source_count", {"eid": engram_id}).execute()

    # Trigger async compilation
    compile_source_task.delay(source_id)

    return {
        "source_id": source_id,
        "status": "queued",
        "message": "Source added. Compilation queued.",
    }
