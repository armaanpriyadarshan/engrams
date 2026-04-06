from typing import Optional, Dict, List
import httpx

from integrations.base import Integration, FetchedSource
from integrations.registry import register
from core.config import settings

NOTION_API = "https://api.notion.com/v1"


def blocks_to_markdown(blocks: list) -> str:
    """Convert Notion blocks to markdown."""
    lines = []
    for block in blocks:
        btype = block.get("type", "")
        data = block.get(btype, {})
        rich_text = data.get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in rich_text)

        if btype == "paragraph":
            lines.append(text)
        elif btype == "heading_1":
            lines.append(f"# {text}")
        elif btype == "heading_2":
            lines.append(f"## {text}")
        elif btype == "heading_3":
            lines.append(f"### {text}")
        elif btype == "bulleted_list_item":
            lines.append(f"- {text}")
        elif btype == "numbered_list_item":
            lines.append(f"1. {text}")
        elif btype == "code":
            lang = data.get("language", "")
            lines.append(f"```{lang}\n{text}\n```")
        elif btype == "quote":
            lines.append(f"> {text}")
        elif btype == "to_do":
            checked = "x" if data.get("checked") else " "
            lines.append(f"- [{checked}] {text}")
        elif btype == "divider":
            lines.append("---")
        elif text:
            lines.append(text)

    return "\n\n".join(lines)


@register
class NotionIntegration(Integration):
    service_name = "notion"
    display_name = "Notion"
    description = "Import pages and databases from your Notion workspace."

    def get_auth_url(self, redirect_uri: str, state: str) -> str:
        return (
            f"https://api.notion.com/v1/oauth/authorize"
            f"?client_id={settings.notion_client_id}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&owner=user"
            f"&state={state}"
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> Dict:
        import base64
        auth = base64.b64encode(
            f"{settings.notion_client_id}:{settings.notion_client_secret}".encode()
        ).decode()

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NOTION_API}/oauth/token",
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={
                    "Authorization": f"Basic {auth}",
                    "Content-Type": "application/json",
                    "Notion-Version": "2022-06-28",
                },
            )
            data = resp.json()

        return {
            "access_token": data["access_token"],
            "metadata": {
                "workspace_name": data.get("workspace_name"),
                "workspace_icon": data.get("workspace_icon"),
            },
            "default_config": {"all_pages": True, "database_ids": [], "page_ids": []},
        }

    async def fetch_sources(
        self,
        access_token: str,
        config: Dict,
        since: Optional[str] = None,
    ) -> List[FetchedSource]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        }
        sources: List[FetchedSource] = []

        async with httpx.AsyncClient() as client:
            # Search for pages
            body: Dict = {"filter": {"property": "object", "value": "page"}, "page_size": 50}
            if since:
                body["filter"] = {
                    "and": [
                        {"property": "object", "value": "page"},
                        {"timestamp": "last_edited_time", "last_edited_time": {"after": since}},
                    ]
                }

            resp = await client.post(
                f"{NOTION_API}/search",
                json=body,
                headers=headers,
            )
            if resp.status_code != 200:
                return sources

            pages = resp.json().get("results", [])

            for page in pages:
                page_id = page["id"]

                # Get page title
                props = page.get("properties", {})
                title = "Untitled"
                for prop in props.values():
                    if prop.get("type") == "title":
                        title_parts = prop.get("title", [])
                        if title_parts:
                            title = "".join(t.get("plain_text", "") for t in title_parts)
                        break

                # Get page blocks (content)
                blocks_resp = await client.get(
                    f"{NOTION_API}/blocks/{page_id}/children?page_size=100",
                    headers=headers,
                )
                if blocks_resp.status_code != 200:
                    continue

                blocks = blocks_resp.json().get("results", [])
                content_md = blocks_to_markdown(blocks)

                if content_md.strip():
                    sources.append(FetchedSource(
                        title=title,
                        content_md=content_md,
                        source_url=page.get("url"),
                        source_type="text",
                        origin_service="notion",
                        metadata={"page_id": page_id},
                    ))

        return sources
