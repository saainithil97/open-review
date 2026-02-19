# Open Review

A multi-agent system that reviews Product Requirements Documents (PRDs) against actual codebases. Upload a PRD, point it at your repo, and get a structured technical review — feasibility analysis, story point estimates, gap identification, and actionable feedback.

Built with the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), Express.js, and React.

## How It Works

Three specialized AI agents collaborate to produce the review:

1. **Tech Lead** reads the PRD, breaks it into sections, and orchestrates the review
2. **Codebase Explorers** (one per section, running in parallel) search your repository for relevant code — existing patterns, dependencies, potential conflicts
3. **Senior Developer** analyzes feasibility, identifies gaps, and estimates complexity based on the PRD and codebase findings

The result is a structured review with an overall score, section-by-section analysis, story point estimates, technical risks, and specific feedback for the PRD author.

### Supplementary Sources

PRDs are often a distillation of information. You can upload reference materials alongside the PRD — design docs, tech specs, meeting notes, user research — so the agents can validate:

- **The why**: Is the business rationale captured correctly?
- **The what**: Does the PRD accurately represent what was decided?

When provided, the review includes a **Source Alignment** section that flags gaps and contradictions between the PRD and its source materials.

## Quick Start

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) with an active Claude Max or Pro subscription, **or** an Anthropic API key

### Setup

```bash
git clone https://github.com/saainithil97/open-review.git
cd open-review
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Authentication

**Option 1 — Claude Max / Pro (recommended):**
Leave `ANTHROPIC_API_KEY` unset in `.env`. The SDK uses your Claude Code CLI session:

```bash
claude login
```

**Option 2 — API key:**
Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`.

### Configuration

Edit `.env` to choose models for each agent:

```env
LEAD_AGENT_MODEL=sonnet        # opus, sonnet, or haiku
EXPLORER_AGENT_MODEL=sonnet
SENIOR_DEV_AGENT_MODEL=sonnet
```

## Usage

1. **Upload a PRD** — drag and drop a `.md`, `.txt`, `.pdf`, or `.docx` file
2. **Set repository path(s)** — one absolute path per line to the codebase(s) you want reviewed against
3. **(Optional) Add reference sources** — expand "Reference Sources" to upload design docs, tech specs, meeting notes, etc. Each file can be labeled. You can also paste free-text context.
4. **Click "Do your magic"** — watch live progress as agents explore your codebase
5. **Read the review** — structured output with scores, analysis, estimates, and feedback

## Review Output

The structured review includes:

| Section | Description |
|---------|-------------|
| **Overall Score** | 1-10 rating with justification |
| **Executive Summary** | 3-5 key findings |
| **Section-by-Section Analysis** | Feasibility, gaps, effort per PRD section |
| **Source Alignment** | Gaps/contradictions vs. reference sources (when provided) |
| **Cross-Cutting Concerns** | Architectural impact, shared dependencies |
| **Missing Context & Gaps** | What engineers would need to ask the PM |
| **Technical Risks** | Severity-ranked risks with mitigation strategies |
| **Story Point Estimates** | Fibonacci-scale table with confidence levels |
| **Feedback for PRD Author** | Strengths and specific improvement suggestions |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)      :5173          │
│  ┌──────────┐ ┌────────────┐ ┌────────────────────────┐ │
│  │FileUpload│ │ ReviewList │ │    ReviewDetail        │ │
│  │          │ │            │ │  ┌───────────────────┐  │ │
│  │ PRD file │ │ Sidebar    │ │  │  ProgressPanel    │  │ │
│  │ Sources  │ │ with cost  │ │  │  (SSE live feed)  │  │ │
│  │ Context  │ │            │ │  ├───────────────────┤  │ │
│  │ Repos    │ │            │ │  │  Markdown output  │  │ │
│  └──────────┘ └────────────┘ │  │  + UsageSummary   │  │ │
│                              │  └───────────────────┘  │ │
│                              └────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │ /api/* proxy
┌──────────────────────▼──────────────────────────────────┐
│  Backend (Express)                       :3001          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  REST API + SSE streaming                           ││
│  │  POST /api/reviews        — upload & start review   ││
│  │  GET  /api/reviews/:id    — get review detail       ││
│  │  GET  /api/reviews/:id/stream — SSE progress events ││
│  └────────────────────┬────────────────────────────────┘│
│                       │                                  │
│  ┌────────────────────▼────────────────────────────────┐│
│  │  Agent Orchestrator (Claude Agent SDK)              ││
│  │                                                     ││
│  │  ┌─────────────┐                                    ││
│  │  │  Tech Lead   │──── delegates via Task tool ──┐   ││
│  │  └─────────────┘                                │   ││
│  │        │                                        │   ││
│  │        ▼                                        ▼   ││
│  │  ┌───────────┐ ┌───────────┐    ┌──────────────┐   ││
│  │  │ Explorer 1│ │ Explorer N│    │ Senior Dev   │   ││
│  │  │ (parallel)│ │ (parallel)│    │ (after all   │   ││
│  │  │ Read/Glob │ │ Read/Glob │    │  explorers)  │   ││
│  │  │ Grep      │ │ Grep      │    │ Read/Glob    │   ││
│  │  └───────────┘ └───────────┘    │ Grep         │   ││
│  │                                  └──────────────┘   ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  Storage: backend/data/uploads/ + backend/data/outputs/  │
└──────────────────────────────────────────────────────────┘
```

## Real-Time Progress

During a review, the frontend shows live updates via Server-Sent Events:

- **Phase stepper** — which stage the review is in (Understanding, Exploring, Analyzing, Synthesizing)
- **Activity feed** — what files agents are reading, what patterns they're searching
- **Subagent tracker** — how many explorers are running vs. complete
- **Token usage** — live cost and token counts
- **Progress bar** — percent complete

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent framework | `@anthropic-ai/claude-agent-sdk` |
| Backend | Express.js, TypeScript, multer, mammoth (docx), pdf-parse |
| Frontend | React 19, Vite, Tailwind CSS, react-markdown + remark-gfm |
| Monorepo | npm workspaces with shared type package |
| Storage | Filesystem (JSON metadata + markdown output) |

## Development

```bash
npm run dev              # Start both backend + frontend
npm run dev:backend      # Backend only (tsx watch, port 3001)
npm run dev:frontend     # Frontend only (vite, port 5173)
npm run build            # Production build (both)
```

Type-check:
```bash
cd backend  && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

Test PRDs are available in `test-prds/` for development and testing.

## License

MIT
