import type { AgentModelChoice, ProgressEvent, SessionUsage } from "prd-reviewer-shared";

/** A parsed supplementary document to be passed to the agent pipeline. */
export interface SupplementaryDocument {
  name: string;
  label?: string;
  content: string;
}

export interface OrchestratorInput {
  prdContent: string;
  /** Supplementary reference sources that validate the PRD's "why" and "what". */
  supplementarySources?: SupplementaryDocument[];
  /** Free-text context from the reviewer (links, notes, rationale). */
  additionalContext?: string;
  repoPaths: string[];
  config: {
    leadModel: AgentModelChoice;
    explorerModel: AgentModelChoice;
    seniorDevModel: AgentModelChoice;
  };
  onProgress?: (event: ProgressEvent) => void;
}

export interface OrchestratorResult {
  output: string;
  costUsd: number;
  durationMs: number;
  usage: SessionUsage;
}
