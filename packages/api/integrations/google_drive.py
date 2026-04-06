from typing import Optional, Dict, List
import httpx

from integrations.base import Integration, FetchedSource
from integrations.registry import register
from core.config import settings
from engine.parser import parse_pdf

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2"
GOOGLE_API = "https://www.googleapis.com"


@register
class GoogleDriveIntegration(Integration):
    service_name = "google_drive"
    display_name = "Google Drive"
    description = "Import documents, spreadsheets, and PDFs from Google Drive."

    def get_auth_url(self, redirect_uri: str, state: str) -> str:
        scopes = "https://www.googleapis.com/auth/drive.readonly"
        return (
            f"{GOOGLE_AUTH}/auth"
            f"?client_id={settings.google_client_id}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={scopes}"
            f"&access_type=offline"
            f"&prompt=consent"
            f"&state={state}"
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> Dict:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{GOOGLE_AUTH}/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            data = resp.json()

        # Get user info
        async with httpx.AsyncClient() as client:
            user_resp = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {data['access_token']}"},
            )
            user = user_resp.json()

        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_at": None,  # Could compute from expires_in
            "metadata": {"email": user.get("email"), "name": user.get("name")},
            "default_config": {"folder_ids": [], "file_types": ["document", "pdf"]},
        }

    async def refresh_access_token(self, refresh_token: str) -> Dict:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{GOOGLE_AUTH}/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            data = resp.json()
        return {"access_token": data["access_token"], "expires_in": data.get("expires_in")}

    async def fetch_sources(
        self,
        access_token: str,
        config: Dict,
        since: Optional[str] = None,
    ) -> List[FetchedSource]:
        headers = {"Authorization": f"Bearer {access_token}"}
        sources: List[FetchedSource] = []
        file_types = config.get("file_types", ["document", "pdf"])

        # Build query
        mime_types = []
        if "document" in file_types:
            mime_types.append("application/vnd.google-apps.document")
        if "pdf" in file_types:
            mime_types.append("application/pdf")
        if "spreadsheet" in file_types:
            mime_types.append("application/vnd.google-apps.spreadsheet")

        q_parts = [f"mimeType='{m}'" for m in mime_types]
        q = f"({' or '.join(q_parts)}) and trashed=false"

        folder_ids = config.get("folder_ids", [])
        if folder_ids:
            folder_q = " or ".join(f"'{fid}' in parents" for fid in folder_ids)
            q += f" and ({folder_q})"

        if since:
            q += f" and modifiedTime > '{since}'"

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GOOGLE_API}/drive/v3/files",
                params={"q": q, "fields": "files(id,name,mimeType,webViewLink,modifiedTime)", "pageSize": 50},
                headers=headers,
            )
            if resp.status_code != 200:
                return sources

            files = resp.json().get("files", [])

            for file in files:
                file_id = file["id"]
                mime = file["mimeType"]
                title = file["name"]

                content_md = None

                if mime == "application/vnd.google-apps.document":
                    # Export Google Doc as markdown (plain text fallback)
                    export_resp = await client.get(
                        f"{GOOGLE_API}/drive/v3/files/{file_id}/export",
                        params={"mimeType": "text/plain"},
                        headers=headers,
                    )
                    if export_resp.status_code == 200:
                        content_md = export_resp.text

                elif mime == "application/pdf":
                    # Download and parse PDF
                    dl_resp = await client.get(
                        f"{GOOGLE_API}/drive/v3/files/{file_id}?alt=media",
                        headers=headers,
                    )
                    if dl_resp.status_code == 200:
                        try:
                            content_md = parse_pdf(dl_resp.content)
                        except Exception:
                            content_md = None

                elif mime == "application/vnd.google-apps.spreadsheet":
                    # Export as CSV
                    export_resp = await client.get(
                        f"{GOOGLE_API}/drive/v3/files/{file_id}/export",
                        params={"mimeType": "text/csv"},
                        headers=headers,
                    )
                    if export_resp.status_code == 200:
                        content_md = f"```csv\n{export_resp.text}\n```"

                if content_md and content_md.strip():
                    sources.append(FetchedSource(
                        title=title,
                        content_md=content_md,
                        source_url=file.get("webViewLink"),
                        source_type="text",
                        origin_service="google_drive",
                        metadata={"file_id": file_id, "mime_type": mime},
                    ))

        return sources
