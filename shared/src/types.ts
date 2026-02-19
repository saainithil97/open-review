// ─── Review Status & Metadata ───────────────────────────────────────────

export type ReviewStatus = "pending" | "running" | "completed" | "error";

/** Metadata for a supplementary reference document uploaded alongside the PRD. */
export interface SupplementarySource {
  fileName: string;
  originalName: string;
  /** Human-readable category: Design Doc, Tech Spec, User Research, Meeting Notes, Other */
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
  /** Supplementary reference documents uploaded alongside the PRD. */
  supplementaryFiles?: SupplementarySource[];
  /** Free-text context provided by the reviewer (links, notes, rationale). */
  additionalContext?: string;
  /** Whether web search is enabled for this review. */
  webSearchEnabled?: boolean;
}

export interface ReviewDetail extends ReviewMeta {
  prdContent?: string;
  reviewOutput?: string;
  /** Parsed text content of each supplementary source file. */
  supplementaryContents?: Array<{
    name: string;
    label?: string;
    content: string;
  }>;
}

export interface CreateReviewRequest {
  repoPaths: string[];
}

export type AgentModelChoice = "opus" | "sonnet" | "haiku";

export interface AgentConfig {
  leadModel: AgentModelChoice;
  explorerModel: AgentModelChoice;
  seniorDevModel: AgentModelChoice;
}

// ─── Token Usage Types ──────────────────────────────────────────────────

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

// ─── Progress Streaming Types ───────────────────────────────────────────

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
