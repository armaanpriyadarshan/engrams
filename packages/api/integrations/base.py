from abc import ABC, abstractmethod
from typing import Optional, Dict, List
from dataclasses import dataclass


@dataclass
class FetchedSource:
    title: str
    content_md: Optional[str] = None
    source_url: Optional[str] = None
    source_type: str = "text"
    origin_service: Optional[str] = None
    metadata: Optional[Dict] = None


class Integration(ABC):
    service_name: str
    display_name: str
    description: str

    @abstractmethod
    def get_auth_url(self, redirect_uri: str, state: str) -> str:
        """Return the OAuth authorization URL for the user to visit."""
        pass

    @abstractmethod
    async def exchange_code(self, code: str, redirect_uri: str) -> Dict:
        """Exchange OAuth code for access/refresh tokens.

        Returns: {"access_token": "...", "refresh_token": "...", "expires_in": ..., "metadata": {...}}
        """
        pass

    async def refresh_access_token(self, refresh_token: str) -> Dict:
        """Refresh an expired access token. Override if the service supports refresh."""
        raise NotImplementedError(f"{self.service_name} does not support token refresh")

    @abstractmethod
    async def fetch_sources(
        self,
        access_token: str,
        config: Dict,
        since: Optional[str] = None,
    ) -> List[FetchedSource]:
        """Fetch new sources from the service since last sync.

        Args:
            access_token: Valid OAuth access token
            config: Service-specific config (repos, folders, etc.)
            since: ISO timestamp of last sync (None for first sync)

        Returns: List of FetchedSource objects to be ingested
        """
        pass
