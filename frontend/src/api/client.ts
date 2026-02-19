const BASE = "/api";

// ─── Review Types ───────────────────────────────────────────────────────

export type ReviewStatus = "pending" | "running" | "completed" | "error";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ModelUsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  contextWindow: number;
}

export interface SubagentUsage {
  agentType: string;
  description: string;
  usage: TokenUsage;
  model: string;
}

export interface SessionUsage {
  totalCostUsd: number;
  totalTokens: TokenUsage;
  modelBreakdown: Record<string, ModelUsageData>;
  subagentBreakdown: SubagentUsage[];
  numTurns: number;
  durationMs: number;
  durationApiMs: number;
}

export interface SupplementarySource {
  fileName: string;
  originalName: string;
  label?: string;
}

export interface ReviewMeta {
  id: string;
  fileName: string;
  originalName: string;
  repoPaths: string[];
  status: ReviewStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
  usage?: SessionUsage;
  supplementaryFiles?: SupplementarySource[];
  additionalContext?: string;
  webSearchEnabled?: boolean;
}

export interface ReviewDetail extends ReviewMeta {
  prdContent?: string;
  reviewOutput?: string;
  supplementaryContents?: Array<{
    name: string;
    label?: string;
    content: string;
  }>;
}

export interface StatusResponse {
  id: string;
  status: ReviewStatus;
  error?: string;
}

// ─── Progress Event Types ───────────────────────────────────────────────

export type ReviewPhase = "understanding" | "exploring" | "analyzing" | "synthesizing";

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

export interface UsageEventData {
  session: TokenUsage;
  subagents: SubagentUsage[];
  costUsd: number;
}

export type ProgressEvent =
  | { type: "phase"; timestamp: string; data: PhaseEventData }
  | { type: "subagent"; timestamp: string; data: SubagentEventData }
  | { type: "activity"; timestamp: string; data: ActivityEventData }
  | { type: "progress"; timestamp: string; data: ProgressEventData }
  | { type: "complete"; timestamp: string; data: CompleteEventData }
  | { type: "usage"; timestamp: string; data: UsageEventData };

// ─── API Client ─────────────────────────────────────────────────────────

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listReviews(): Promise<ReviewMeta[]> {
  return request<ReviewMeta[]>("/reviews");
}

export async function getReview(id: string): Promise<ReviewDetail> {
  return request<ReviewDetail>(`/reviews/${id}`);
}

export async function getReviewStatus(id: string): Promise<StatusResponse> {
  return request<StatusResponse>(`/reviews/${id}/status`);
}

export async function createReview(
  file: File,
  repoPaths: string[],
  supplementaryFiles?: Array<{ file: File; label?: string }>,
  additionalContext?: string,
  webSearchEnabled?: boolean,
): Promise<ReviewMeta> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("repoPaths", JSON.stringify(repoPaths));

  if (supplementaryFiles && supplementaryFiles.length > 0) {
    for (const sf of supplementaryFiles) {
      formData.append("supplementaryFiles", sf.file);
    }
    // Labels sent as a parallel JSON array (FormData can't carry per-file metadata)
    const labels = supplementaryFiles.map((sf) => sf.label || "");
    formData.append("supplementaryLabels", JSON.stringify(labels));
  }

  if (additionalContext?.trim()) {
    formData.append("additionalContext", additionalContext);
  }

  if (webSearchEnabled) {
    formData.append("webSearchEnabled", "true");
  }

  return request<ReviewMeta>("/reviews", {
    method: "POST",
    body: formData,
  });
}

export async function rerunReview(id: string): Promise<ReviewMeta> {
  return request<ReviewMeta>(`/reviews/${id}/rerun`, { method: "POST" });
}

// ─── SSE Progress Stream ────────────────────────────────────────────────

/**
 * Open an SSE connection to stream progress events for a review.
 * Returns a cleanup function that closes the connection.
 *
 * The `onError` callback receives the EventSource instance so callers
 * can inspect `readyState` (CONNECTING vs CLOSED) to decide whether
 * the error is a transient reconnection or a permanent failure.
 */
export function streamReviewProgress(
  reviewId: string,
  onEvent: (event: ProgressEvent) => void,
  onError?: (error: Event, source: EventSource) => void,
): () => void {
  const source = new EventSource(`${BASE}/reviews/${reviewId}/stream`);

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as ProgressEvent;
      onEvent(event);
    } catch {
      // Ignore parse errors
    }
  };

  source.onerror = (e) => {
    onError?.(e, source);
  };

  return () => source.close();
}
