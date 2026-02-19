# AGENTS.md

> Instructions for AI coding agents operating in this repository.
> This file is a living document — update it as the project evolves.

---

## Project Overview

This repository contains **PRD Reviewer** (open-review) — a multi-agent system
that reviews Product Requirements Documents against actual codebases and
supplementary reference sources. It uses the Claude Agent SDK with a lead
orchestrator agent, parallel codebase explorer subagents, and a senior
developer analysis subagent.

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
├── AGENTS.md                     # Agent instructions (this file)
├── README.md                     # Project documentation
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # Express server entry point (timeout config)
│   │   ├── routes/reviews.ts     # REST API + SSE stream endpoints
│   │   ├── agents/
│   │   │   ├── orchestrator.ts   # Lead agent + Claude Agent SDK query()
│   │   │   ├── prompts.ts        # System prompts for all agents
│   │   │   └── types.ts          # Agent-specific types (OrchestratorInput/Result)
│   │   ├── services/
│   │   │   ├── fileParser.ts     # .docx / .pdf / .md parsing
│   │   │   └── storage.ts        # File I/O + review metadata + supplementary files
│   │   └── utils/logger.ts       # Logging utility
│   └── data/
│       ├── uploads/              # Uploaded PRD + supplementary files
│       └── outputs/              # Review output (meta.json + review.md per review)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts            # Vite config with API proxy + SSE timeout settings
│   ├── index.html
│   └── src/
│       ├── App.tsx               # Main app layout
│       ├── main.tsx              # React entry point
│       ├── index.css             # Tailwind CSS entry
│       ├── components/
│       │   ├── FileUpload.tsx    # Upload form: PRD + supplementary sources + context
│       │   ├── ProgressPanel.tsx # Live SSE progress: phases, activity, token usage
│       │   ├── ReviewList.tsx    # Sidebar list of all reviews with cost display
│       │   ├── ReviewDetail.tsx  # Review output viewer + UsageSummary
│       │   └── StatusBadge.tsx   # Status indicator component
│       └── api/client.ts         # Typed API client + SSE streaming
├── shared/
│   └── src/types.ts              # Types shared between FE and BE
└── test-prds/                    # Sample PRDs for testing
    ├── 01-realtime-streaming.md
    ├── 02-review-analytics-dashboard.md
    ├── 03-multi-user-auth-teams.md
    └── 04-review-comparison-diff.md
```

---

## Environment Setup

```bash
cd prd_reviewer
cp .env.example .env              # Configure auth + model choices
npm install                       # Install all workspace dependencies
npm run dev                       # Start backend + frontend
```

The frontend runs on `http://localhost:5173` and proxies `/api/*` to the
backend on port `3001`.

### Authentication

Two options:

1. **Claude Max / Pro subscription** (recommended for local dev):
   Leave `ANTHROPIC_API_KEY` unset. The Agent SDK uses the Claude Code CLI
   OAuth session. Make sure the CLI is logged in: `claude login`.

2. **API key**: Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`.

---

## Agent Architecture

The system uses three agent types via the Claude Agent SDK:

| Agent | Tools | Model | Role |
|-------|-------|-------|------|
| **Tech Lead** (orchestrator) | `Task` only | Configurable | Reads PRD + sources, splits into sections, delegates, synthesizes final review |
| **Codebase Explorer** (N parallel) | `Read`, `Glob`, `Grep` | Configurable | Searches repos for code relevant to each PRD section |
| **Senior Developer** (1 instance) | `Read`, `Glob`, `Grep` | Configurable | Feasibility analysis, gap identification, story point estimates |

### Pipeline Flow

1. **Tech Lead** reads the PRD and supplementary sources, breaks into 3-5 sections
2. **Codebase Explorers** (one per section) search repos in parallel
3. **Senior Developer** receives PRD + explorer findings + supplementary sources for analysis
4. **Tech Lead** synthesizes everything into the structured review output

### Supplementary Sources

Users can upload reference materials alongside the PRD:
- Design docs, tech specs, meeting notes, user research, API contracts
- Each file gets an optional label (e.g., "Design Doc", "Tech Spec")
- A free-text "Additional Context" field is also available
- Agents use these to validate the PRD's accuracy (the "why" and "what")
- When provided, the output includes a **Source Alignment** section

### Review Output Format

The structured review includes:
- Overall score (1-10) with justification
- Executive summary
- Section-by-section analysis (feasibility, gaps, effort estimates)
- Source Alignment (when supplementary sources provided)
- Cross-cutting concerns
- Missing context & gaps
- Technical risks with severity and mitigation
- Story point estimates table (Fibonacci: 1, 2, 3, 5, 8, 13)
- Feedback for the PRD author

Agent prompts live in `backend/src/agents/prompts.ts`.
Orchestration logic lives in `backend/src/agents/orchestrator.ts`.

---

## Real-Time Progress Streaming

The backend emits Server-Sent Events (SSE) during review execution:

- **Phase events**: understanding, exploring, analyzing, synthesizing
- **Subagent events**: started/completed for each explorer and senior dev
- **Activity events**: throttled tool usage (Read, Glob, Grep) per subagent
- **Progress events**: percent complete with human-readable messages
- **Usage events**: periodic token counts and cost estimates
- **Complete event**: final status (completed/error)

### SSE Implementation Notes

- SSE endpoint: `GET /api/reviews/:id/stream`
- Route registered BEFORE the `/:id` catch-all in Express router
- Socket timeouts disabled on SSE connections (`req.socket.setTimeout(0)`)
- Server-level timeout disabled (`server.timeout = 0`)
- Vite proxy configured with `timeout: 0`, `proxyTimeout: 0` for SSE
- Keepalive comments every 10 seconds
- Frontend retries up to 3 consecutive errors before falling back to polling
- Emitter cleanup delayed 3 seconds after review completion

---

## Key Technical Decisions & Discoveries

- **`react-markdown` v9 + CommonMark**: Tables require `remark-gfm` plugin.
- **`import.meta.dirname`**: Doesn't work in `tsx` — use
  `path.dirname(fileURLToPath(import.meta.url))` instead.
- **SSE route ordering**: `/:id/stream` and `/:id/status` must be registered
  before the `/:id` catch-all in Express router.
- **Agent SDK model IDs**: `AgentDefinition.model` accepts shorthands
  ("sonnet"/"opus"/"haiku"), but `query()` options need full model IDs
  mapped via `MODEL_MAP` in orchestrator.ts.
- **Token tracking**: `SDKAssistantMessage.parent_tool_use_id` is `null` for
  lead agent messages, non-null for subagent messages (matched to Task
  tool_use_id).
- **Multer multi-file**: Uses `upload.fields()` with `file` (PRD, max 1) and
  `supplementaryFiles` (max 10). Labels sent as a parallel JSON array in
  form body.

---

## Agent-Specific Notes

- **Always read this file first** when starting work in this repo.
- **Do not create files unnecessarily** — prefer editing existing files.
- The `.env` file contains secrets — never commit it.
- `backend/data/` is gitignored except for `.gitkeep` files.
- When modifying agent prompts, test with a small PRD first to save API cost.
- The frontend proxies API calls — no CORS issues in dev mode.
- Supplementary file storage uses naming: `{id}_supp_{index}_{safeName}`.
- The `shared` package is consumed by both FE and BE — keep types in sync.
