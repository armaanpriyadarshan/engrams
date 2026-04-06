# Engrams FastAPI Backend (Future Scaling Path)

This directory contains a FastAPI backend with Celery workers that mirrors the functionality currently running on Supabase Edge Functions. It exists as the **scaling path** for when Edge Functions aren't sufficient.

## When to deploy this backend

- Edge Function timeouts become a problem (>150s for heavy compilations)
- You need complex job queuing with retries beyond what pg_cron provides
- You're processing 500+ page PDFs or running OCR on images
- You have 10,000+ users and need dedicated compute
- You want background agents (Linter, Freshener, Discoverer) running complex multi-minute analysis

## Current state

The backend includes:
- FastAPI app with CORS, health endpoint
- Compilation engine (Python port of compile-source Edge Function)
- File parsers (PDF via pymupdf, DOCX via python-docx)
- Celery + Redis for async task processing
- Integration framework with GitHub, Notion, Google Drive implementations
- Docker Compose for local development

## How to run

```bash
cp .env.example .env  # Fill in your keys
docker-compose up
```

The API runs on `http://localhost:8000`. Set `NEXT_PUBLIC_API_URL=http://localhost:8000` in the web app's `.env.local` to use it.

## Architecture

All backend logic has equivalent Edge Function implementations on Supabase. The Python code here is a 1:1 port that can be deployed to Railway, Fly.io, or any Docker host when the scaling threshold is reached.
