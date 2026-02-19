# PRD: Real-Time Agent Progress Streaming

**Author:** Sarah Chen, Product Manager
**Date:** February 2026
**Status:** Draft
**Priority:** High

---

## 1. Problem Statement

Currently, when a user uploads a PRD and clicks "Do your magic," they see a generic spinner with the message "Agents are reviewing your PRD..." for the entire duration of the review (which can take 2-5 minutes). The user has no visibility into what the agents are actually doing — which agent is running, what files are being explored, how far along the process is.

This creates uncertainty and erodes trust: users don't know if the system is stuck, progressing, or about to finish. Multiple users in testing sessions have reported closing the tab thinking the system had frozen.

## 2. Goals

- Provide real-time visibility into agent activity during a PRD review.
- Show which phase of the pipeline is active (Understanding, Exploring, Analyzing, Synthesizing).
- Display individual subagent activity (e.g., "Explorer 1: searching auth module...", "Explorer 3: reading database models...").
- Reduce perceived wait time through meaningful progress updates.
- Maintain the existing polling fallback for clients that don't support SSE.

## 3. Non-Goals

- We are NOT building a full agent debugging UI (no raw tool call inspection).
- We are NOT adding the ability to pause/resume or cancel a running review in this iteration.
- We are NOT changing the agent pipeline itself — this is purely an observability feature.
- We are NOT persisting progress events — they are ephemeral.

## 4. Proposed Solution

### 4.1 Backend: Server-Sent Events (SSE) Endpoint

Add a new SSE endpoint that streams progress events to the frontend while a review is running.

**Why SSE over WebSocket:** SSE is simpler to implement (no library needed — native `EventSource` on the client, plain HTTP on the server), works through the existing Vite dev proxy without special configuration, and is sufficient for our use case (server-to-client unidirectional stream). No new dependencies are required.

**New endpoint:**

```
GET /api/reviews/:id/stream
```

Response content type: `text/event-stream`

Event types:

| Event Type | Payload | Emitted When |
|------------|---------|--------------|
| `phase` | `{ phase: "understanding" \| "exploring" \| "analyzing" \| "synthesizing", message: string }` | Pipeline transitions between phases |
| `subagent` | `{ agentType: string, description: string, status: "started" \| "completed" }` | A subagent is launched or finishes |
| `activity` | `{ agentType: string, tool: string, detail: string }` | An agent uses a tool (Read, Glob, Grep) |
| `progress` | `{ percent: number, message: string }` | Estimated overall progress (0-100) |
| `complete` | `{ status: "completed" \| "error", message?: string }` | Review finishes |

### 4.2 Backend: Orchestrator Changes

The existing `runReview()` function in `backend/src/agents/orchestrator.ts` already iterates over streamed `SDKMessage` objects from the Agent SDK's `query()` generator. The code at lines 79-91 already detects `assistant` messages and `Task` tool invocations. We extend this:

1. Add an optional `onProgress: (event: ProgressEvent) => void` callback parameter to `runReview()`.
2. Detect phase transitions by examining task delegations:
   - When the lead agent's first text output appears before any Task calls -> phase: "understanding"
   - When it invokes Task for `codebase-explorer` -> phase: "exploring"
   - When it invokes Task for `senior-developer` -> phase: "analyzing"
   - When the senior-developer result comes back and the lead starts producing final output -> phase: "synthesizing"
3. Detect tool usage within subagent messages (those with `parent_tool_use_id !== null`) and emit `activity` events with the tool name and a summary of the input (e.g., file path for Read, pattern for Grep).
4. Estimate progress percentage based on phase: understanding=10%, exploring=10-60% (interpolated by subagent completion count), analyzing=60-85%, synthesizing=85-100%.

### 4.3 Backend: Route and Event Plumbing

In `backend/src/routes/reviews.ts`:

1. Add an in-memory `Map<string, EventEmitter>` called `reviewEmitters` to track active review streams.
2. When `startReviewProcess()` kicks off a review, create an `EventEmitter` for that review ID and store it in the map.
3. Pass a callback that calls `emitter.emit("progress", event)` as the `onProgress` parameter to `runReview()`.
4. Implement `GET /api/reviews/:id/stream`:
   - Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
   - If the review is not running, return 404 or an immediate `complete` event based on current status.
   - Subscribe to the emitter and write each event as `data: ${JSON.stringify(event)}\n\n`.
   - Send `:keepalive\n\n` comments every 15 seconds to prevent proxy/browser timeouts.
   - On client disconnect (`req.on("close")`), remove the listener and clean up.
5. When the review completes, emit `complete`, then delete the emitter from the map.

### 4.4 Frontend: ProgressPanel Component

Create a new `frontend/src/components/ProgressPanel.tsx` component that replaces the static spinner in `ReviewDetail.tsx`:

**Behavior:**
1. Opens an `EventSource` connection to `/api/reviews/:id/stream` when the review status is "running" or "pending".
2. Displays a vertical step indicator showing the 4 phases, with the current phase highlighted and completed phases checked.
3. Below the step indicator, shows a scrolling activity feed with timestamped entries like:
   - "Explorer (auth section): Reading backend/src/routes/reviews.ts"
   - "Explorer (database section): Searching for model definitions..."
   - "Senior Developer: Analyzing feasibility..."
4. Auto-scrolls the feed to the latest entry.
5. Shows a progress bar at the top based on `progress` events.
6. Falls back to the existing 3-second polling behavior if the `EventSource` connection fails or errors (by listening to the `onerror` event).
7. Closes the `EventSource` on component unmount or when a `complete` event is received.

**Integration with ReviewDetail.tsx:**
- In `ReviewDetail.tsx`, replace the current "running" block (lines ~103-116, the `div` with `animate-spin` spinner) with `<ProgressPanel reviewId={reviewId} onComplete={fetchReview} />`.
- The `onComplete` callback triggers a full detail refetch to load the review output.

### 4.5 Shared Types

Add to `shared/src/types.ts`:

```typescript
export type ReviewPhase = "understanding" | "exploring" | "analyzing" | "synthesizing";

export type ProgressEventType = "phase" | "subagent" | "activity" | "progress" | "complete";

export interface ProgressEvent {
  type: ProgressEventType;
  timestamp: string;
  data: PhaseEventData | SubagentEventData | ActivityEventData | ProgressEventData | CompleteEventData;
}

export interface PhaseEventData {
  phase: ReviewPhase;
  message: string;
}

export interface SubagentEventData {
  agentType: string;
  description: string;
  status: "started" | "completed";
}

export interface ActivityEventData {
  agentType: string;
  tool: string;
  detail: string;
}

export interface ProgressEventData {
  percent: number;
  message: string;
}

export interface CompleteEventData {
  status: "completed" | "error";
  message?: string;
}
```

### 4.6 API Client Update

Add to `frontend/src/api/client.ts`:

```typescript
export function streamReviewProgress(
  reviewId: string,
  onEvent: (event: ProgressEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`${BASE}/reviews/${reviewId}/stream`);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch { /* ignore parse errors */ }
  };
  if (onError) source.onerror = onError;
  // Return cleanup function
  return () => source.close();
}
```

## 5. Technical Considerations

### 5.1 Memory Management

The `reviewEmitters` map only holds entries for actively running reviews. Entries are removed on completion or error. Since the app is local-only and typically runs one review at a time, memory pressure is negligible. Even with multiple concurrent reviews, each emitter is lightweight.

### 5.2 Multiple Clients

Multiple browser tabs can connect to the same review's SSE stream. `EventEmitter` supports multiple listeners natively. Each listener is independently cleaned up on client disconnect.

### 5.3 Reconnection

The browser's `EventSource` API automatically reconnects on connection loss with exponential backoff. Combined with the 15-second keepalive, this ensures robust connection handling.

### 5.4 Backward Compatibility

The existing `GET /api/reviews/:id/status` polling endpoint remains unchanged. The SSE stream is purely additive. The frontend component falls back to polling if SSE fails. No breaking changes.

### 5.5 Activity Event Granularity

To avoid overwhelming the UI, we should throttle `activity` events:
- Emit at most one activity event per agent per second.
- Only emit for "interesting" tool calls: file reads (with the file path), grep searches (with the pattern), and glob searches (with the pattern). Skip internal tool calls.

## 6. User Experience

### Current State
```
[Upload PRD] -> [Spinner: "Agents are reviewing your PRD..."] -> [Result after 2-5 min]
```

### Proposed State
```
[Upload PRD] -> [Progress Panel:
  ============ 45% ============

  [x] Understanding PRD
      Identified 4 sections: Authentication, Data Model, API Endpoints, UI Components

  [*] Exploring codebase (2 of 4 explorers complete)
      Explorer (Authentication): Completed - found 12 relevant files
      Explorer (Data Model): Completed - found 8 relevant files
      Explorer (API Endpoints): Reading backend/src/routes/reviews.ts...
      Explorer (UI Components): Searching for React components...

  [ ] Senior developer analysis
  [ ] Final synthesis
] -> [Result]
```

## 7. Success Metrics

- Zero users report thinking the system is "stuck" during a review.
- Tab close rate during review processing drops by >50%.
- No regression in review completion rate or quality.
- SSE connection success rate >95% (with polling fallback covering the rest).

## 8. Rollout Plan

1. **Phase 1 (Backend):** SSE endpoint + orchestrator `onProgress` callback. Testable via `curl -N http://localhost:3001/api/reviews/:id/stream`.
2. **Phase 2 (Frontend):** `ProgressPanel` component integration into `ReviewDetail.tsx`.
3. **Phase 3 (Polish):** Animations, activity throttling tuning, error state handling.

## 9. Open Questions

1. Should we persist progress events to disk for post-hoc debugging? (Leaning no for v1 — keep it ephemeral.)
2. What's the ideal throttle rate for activity events? Proposal: 1 event/agent/second, tunable.
3. Should completed reviews show a "replay" of the progress timeline? (Leaning no — out of scope.)
