from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    openai_api_key: str
    redis_url: str = "redis://redis:6379/0"

    # OAuth — GitHub
    github_client_id: str = ""
    github_client_secret: str = ""

    # OAuth — Notion
    notion_client_id: str = ""
    notion_client_secret: str = ""

    # OAuth — Google
    google_client_id: str = ""
    google_client_secret: str = ""

    # Frontend URL (for OAuth redirects)
    frontend_url: str = "http://localhost:3000"

    class Config:
        env_file = ".env"


settings = Settings()
