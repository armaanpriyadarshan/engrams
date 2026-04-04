from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.database import get_supabase
from workers.tasks import compile_source_task

router = APIRouter()


class CompileRequest(BaseModel):
    source_id: str


@router.post("/{engram_id}/compile")
async def trigger_compile(engram_id: str, body: CompileRequest):
    supabase = get_supabase()

    # Verify source exists and belongs to engram
    result = supabase.table("sources").select("id").eq("id", body.source_id).eq("engram_id", engram_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Source not found")

    compile_source_task.delay(body.source_id)

    return {"status": "queued", "source_id": body.source_id}
