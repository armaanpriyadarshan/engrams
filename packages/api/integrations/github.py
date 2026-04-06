from typing import Optional, Dict, List
import httpx

from integrations.base import Integration, FetchedSource
from integrations.registry import register
from core.config import settings


@register
class GitHubIntegration(Integration):
    service_name = "github"
    display_name = "GitHub"
    description = "Import READMEs, docs, issues, and wiki pages from your repositories."

    def get_auth_url(self, redirect_uri: str, state: str) -> str:
        return (
            f"https://github.com/login/oauth/authorize"
            f"?client_id={settings.github_client_id}"
            f"&redirect_uri={redirect_uri}"
            f"&scope=repo"
            f"&state={state}"
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> Dict:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://github.com/login/oauth/access_token",
                json={
                    "client_id": settings.github_client_id,
                    "client_secret": settings.github_client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            data = resp.json()

        # Get user info
        async with httpx.AsyncClient() as client:
            user_resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {data['access_token']}"},
            )
            user = user_resp.json()

        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "metadata": {"username": user.get("login"), "avatar": user.get("avatar_url")},
            "default_config": {"repos": [], "include_docs": True, "include_readme": True, "include_issues": False},
        }

    async def fetch_sources(
        self,
        access_token: str,
        config: Dict,
        since: Optional[str] = None,
    ) -> List[FetchedSource]:
        headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github.v3+json"}
        sources: List[FetchedSource] = []
        repos = config.get("repos", [])

        async with httpx.AsyncClient() as client:
            # If no repos configured, fetch user's recent repos
            if not repos:
                resp = await client.get(
                    "https://api.github.com/user/repos?sort=updated&per_page=10",
                    headers=headers,
                )
                if resp.status_code == 200:
                    repos = [r["full_name"] for r in resp.json()]

            for repo in repos:
                # Fetch README
                if config.get("include_readme", True):
                    resp = await client.get(
                        f"https://api.github.com/repos/{repo}/readme",
                        headers={**headers, "Accept": "application/vnd.github.v3.raw"},
                    )
                    if resp.status_code == 200:
                        sources.append(FetchedSource(
                            title=f"{repo} — README",
                            content_md=resp.text,
                            source_url=f"https://github.com/{repo}",
                            source_type="text",
                            origin_service="github",
                            metadata={"repo": repo, "file": "README.md"},
                        ))

                # Fetch docs directory
                if config.get("include_docs", True):
                    for docs_dir in ["docs", "doc", "documentation"]:
                        resp = await client.get(
                            f"https://api.github.com/repos/{repo}/contents/{docs_dir}",
                            headers=headers,
                        )
                        if resp.status_code == 200:
                            for item in resp.json():
                                if item["type"] == "file" and item["name"].endswith((".md", ".txt", ".rst")):
                                    file_resp = await client.get(
                                        item["download_url"],
                                        headers=headers,
                                    )
                                    if file_resp.status_code == 200:
                                        sources.append(FetchedSource(
                                            title=f"{repo} — {item['name']}",
                                            content_md=file_resp.text,
                                            source_url=item["html_url"],
                                            source_type="text",
                                            origin_service="github",
                                            metadata={"repo": repo, "file": item["path"]},
                                        ))
                            break  # Found docs dir, don't check alternatives

                # Fetch recent issues
                if config.get("include_issues", False):
                    params = "state=open&per_page=20&sort=updated"
                    if since:
                        params += f"&since={since}"
                    resp = await client.get(
                        f"https://api.github.com/repos/{repo}/issues?{params}",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        for issue in resp.json():
                            if issue.get("pull_request"):
                                continue  # Skip PRs
                            body = issue.get("body") or ""
                            sources.append(FetchedSource(
                                title=f"{repo} #{issue['number']}: {issue['title']}",
                                content_md=f"# {issue['title']}\n\n{body}",
                                source_url=issue["html_url"],
                                source_type="text",
                                origin_service="github",
                                metadata={"repo": repo, "issue": issue["number"]},
                            ))

        return sources
