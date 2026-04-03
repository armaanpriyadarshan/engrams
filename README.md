# engrams

Your knowledge, compiled.

Feed it anything. Ask it everything. It evolves.

## What is an engram?

An engram is a living knowledge organism. Feed it raw sources — URLs, PDFs, text, voice memos, anything — and an LLM compiles them into structured, interlinked articles. Every query compounds back into the wiki. Background agents tend the engram when you're not using it.

## Stack

- **Web** — Next.js 16, TypeScript, Tailwind CSS v4, Three.js
- **Database** — Supabase (Postgres + Auth + Realtime)
- **Desktop** — Tauri (planned)
- **Mobile** — Expo (planned)
- **Extension** — Chrome MV3 (planned)

## Getting started

```bash
cd apps/web
cp .env.local.example .env.local  # add your Supabase keys
npm install
npm run dev
```

## Project structure

```
engrams/
├── apps/
│   ├── web/              # Next.js app
│   ├── desktop/          # Tauri (planned)
│   ├── mobile/           # Expo (planned)
│   └── extension/        # Chrome MV3 (planned)
├── docs/                 # Vision, design system, features, architecture, roadmap
└── CLAUDE.md             # Development context
```

## Documentation

- [Vision](docs/vision.md) — mental model, principles, what makes it different
- [Design System](docs/design-system.md) — colors, typography, components
- [Features](docs/features.md) — full feature set
- [Architecture](docs/architecture.md) — system overview, database, deployment
- [Roadmap](docs/roadmap.md) — build phases
