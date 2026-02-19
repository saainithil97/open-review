# AGENTS.md

> Instructions for AI coding agents operating in this repository.
> This file is a living document — update it as the project evolves.

---

## Project Overview

This repository contains **PRD Reviewer** — a multi-agent system that reviews
Product Requirements Documents against actual codebases. It uses the Claude
Agent SDK with a lead orchestrator agent, parallel codebase explorer subagents,
and a senior developer analysis subagent.

**Tech stack:** TypeScript monorepo (npm workspaces), Express.js backend,
React + Vite + Tailwind CSS frontend, `@anthropic-ai/claude-agent-sdk`.

---

## Build / Lint / Test Commands

All commands run from the monorepo root: `prd_reviewer/`

### Install

```bash
cd prd_reviewer && npm install
```

### Dev (both frontend + backend)

```bash
npm run dev            # Runs backend (port 3001) + frontend (port 5173) concurrently
npm run dev:backend    # Backend only (tsx watch)
npm run dev:frontend   # Frontend only (vite dev server)
```

### Build

```bash
npm run build          # Build both backend and frontend
npm run build:backend  # Backend only (tsc)
npm run build:frontend # Frontend only (vite build)
```

### Type-check

```bash
cd backend  && npx tsc --noEmit   # Backend type-check
cd frontend && npx tsc --noEmit   # Frontend type-check
```

### Lint

No linter is configured yet. When added, document the command here.

### Test

No test framework is configured yet. When added:
```bash
# npm test                       # Run all tests
# npm test -- path/to/test.ts    # Single file
# npm test -- -t "test name"     # Single test by name
```

---

## Code Style Guidelines

### Language & Runtime

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 18+
- **Package manager:** npm with workspaces

### Formatting

- 2-space indentation for all TypeScript/TSX/JSON files.
- Max line width: ~100 characters (soft limit).
- Use double quotes for strings.
- Trailing commas in multi-line structures.

### Imports

- Group: Node.js built-ins, then third-party, then local.
- Use `.js` extensions in backend imports (required for ESM).
- Use `type` keyword for type-only imports: `import type { Foo } from "..."`.
- No wildcard imports.

### Naming Conventions

- **Files:** `camelCase.ts` for modules, `PascalCase.tsx` for React components.
- **Classes/Components:** `PascalCase`.
- **Functions/variables:** `camelCase`.
- **Constants:** `UPPER_SNAKE_CASE`.
- **Types/Interfaces:** `PascalCase` (e.g., `ReviewMeta`, `AgentConfig`).

### Types

- TypeScript `strict: true` is enabled in all tsconfig files.
- Explicit return types on exported functions.
- Avoid `any` — use `unknown` and narrow, or document why `any` is needed.
- Shared types live in `shared/src/types.ts`.

### Error Handling

- Never silently swallow exceptions — at minimum, log with `logger.error()`.
- Use the `logger` utility (`backend/src/utils/logger.ts`) instead of `console.*`.
- Return errors early; avoid deep nesting.
- API routes must return proper HTTP status codes and JSON error bodies.

### Documentation

- Public functions should have JSDoc or a `/** ... */` comment.
- Keep comments focused on *why*, not *what*.
- Update this AGENTS.md when adding new tooling or changing conventions.

---

## Project Structure

```
prd_reviewer/
├── package.json                  # Root workspace config
├── .env.example                  # Environment variable template
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # Express server entry point
│   │   ├── routes/reviews.ts     # REST API endpoints
│   │   ├── agents/
│   │   │   ├── orchestrator.ts   # Lead agent + Claude Agent SDK query()
│   │   │   ├── prompts.ts        # System prompts for all agents
│   │   │   └── types.ts          # Agent-specific types
│   │   ├── services/
│   │   │   ├── fileParser.ts     # .docx / .pdf / .md parsing
│   │   │   └── storage.ts        # File I/O + review metadata
│   │   └── utils/logger.ts       # Logging utility
│   └── data/
│       ├── uploads/              # Uploaded PRD documents
│       └── outputs/              # Review output (markdown per review)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts            # Vite config with API proxy
│   ├── index.html
│   └── src/
│       ├── App.tsx               # Main app layout
│       ├── main.tsx              # React entry point
│       ├── index.css             # Tailwind CSS entry
│       ├── components/
│       │   ├── FileUpload.tsx    # Upload form with drag-and-drop
│       │   ├── ReviewList.tsx    # Sidebar list of all reviews
│       │   ├── ReviewDetail.tsx  # Review output viewer with polling
│       │   └── StatusBadge.tsx   # Status indicator component
│       └── api/client.ts         # Typed API client
└── shared/
    └── src/types.ts              # Types shared between FE and BE
```

---

## Environment Setup

```bash
cd prd_reviewer
cp .env.example .env              # Add your ANTHROPIC_API_KEY
npm install                       # Install all workspace dependencies
npm run dev                       # Start backend + frontend
```

The frontend runs on `http://localhost:5173` and proxies `/api/*` to the
backend on port `3001`.

---

## Agent Architecture

The system uses three agent types via the Claude Agent SDK:

| Agent | Tools | Model | Role |
|-------|-------|-------|------|
| **Tech Lead** (orchestrator) | `Task` only | Configurable | Splits PRD, delegates, synthesizes |
| **Codebase Explorer** (N instances) | `Read`, `Glob`, `Grep` | Configurable | Searches repos per PRD section |
| **Senior Developer** (1 instance) | `Read`, `Glob`, `Grep` | Configurable | Feasibility, gaps, estimates |

Agent prompts live in `backend/src/agents/prompts.ts`.
Orchestration logic lives in `backend/src/agents/orchestrator.ts`.

---

## Agent-Specific Notes

- **Always read this file first** when starting work in this repo.
- **Do not create files unnecessarily** — prefer editing existing files.
- The `.env` file contains secrets — never commit it.
- `backend/data/` is gitignored except for `.gitkeep` files.
- When modifying agent prompts, test with a small PRD first to save API cost.
- The frontend proxies API calls — no CORS issues in dev mode.
