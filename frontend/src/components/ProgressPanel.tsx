import { useState, useEffect, useRef, useCallback } from "react";
import {
  streamReviewProgress,
  getReviewStatus,
} from "../api/client";
import type {
  ProgressEvent,
  ReviewPhase,
  SubagentUsage,
  TokenUsage,
} from "../api/client";

interface ProgressPanelProps {
  reviewId: string;
  onComplete: () => void;
}

interface PhaseInfo {
  key: ReviewPhase;
  label: string;
  status: "pending" | "active" | "completed";
  message?: string;
}

interface SubagentInfo {
  agentType: string;
  description: string;
  status: "started" | "completed";
}

interface ActivityEntry {
  timestamp: string;
  agentType: string;
  tool: string;
  detail: string;
}

const PHASE_ORDER: ReviewPhase[] = ["understanding", "exploring", "analyzing", "synthesizing"];
const PHASE_LABELS: Record<ReviewPhase, string> = {
  understanding: "Understanding PRD",
  exploring: "Exploring codebase",
  analyzing: "Senior developer analysis",
  synthesizing: "Synthesizing final review",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return `${min}m ${remainSec}s`;
}

export default function ProgressPanel({ reviewId, onComplete }: ProgressPanelProps) {
  const [phases, setPhases] = useState<PhaseInfo[]>(
    PHASE_ORDER.map((key) => ({
      key,
      label: PHASE_LABELS[key],
      status: key === "understanding" ? "active" : "pending",
    })),
  );
  const [percent, setPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("Starting...");
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [sessionTokens, setSessionTokens] = useState<TokenUsage | null>(null);
  const [subagentUsages, setSubagentUsages] = useState<SubagentUsage[]>([]);
  const [costUsd, setCostUsd] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [fallbackPolling, setFallbackPolling] = useState(false);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const sseErrorCountRef = useRef(0);
  /** Number of consecutive SSE errors before falling back to polling. */
  const SSE_MAX_ERRORS = 3;

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  const handleEvent = useCallback((event: ProgressEvent) => {
    switch (event.type) {
      case "phase": {
        const { phase, message } = event.data;
        setPhases((prev) =>
          prev.map((p) => {
            if (p.key === phase) return { ...p, status: "active", message };
            const phaseIdx = PHASE_ORDER.indexOf(phase);
            const pIdx = PHASE_ORDER.indexOf(p.key);
            if (pIdx < phaseIdx) return { ...p, status: "completed" };
            return p;
          }),
        );
        break;
      }
      case "subagent": {
        const { agentType, description, status } = event.data;
        setSubagents((prev) => {
          const existing = prev.find(
            (s) => s.agentType === agentType && s.description === description,
          );
          if (existing) {
            return prev.map((s) =>
              s.agentType === agentType && s.description === description
                ? { ...s, status }
                : s,
            );
          }
          return [...prev, { agentType, description, status }];
        });
        break;
      }
      case "activity": {
        const { agentType, tool, detail } = event.data;
        setActivities((prev) => {
          const next = [
            ...prev,
            { timestamp: event.timestamp, agentType, tool, detail },
          ];
          // Keep last 50 entries
          return next.length > 50 ? next.slice(-50) : next;
        });
        break;
      }
      case "progress": {
        setPercent(event.data.percent);
        setProgressMessage(event.data.message);
        break;
      }
      case "usage": {
        setSessionTokens(event.data.session);
        setSubagentUsages(event.data.subagents);
        setCostUsd(event.data.costUsd);
        break;
      }
      case "complete": {
        if (event.data.status === "completed") {
          setPercent(100);
          setProgressMessage("Review complete!");
          setPhases((prev) => prev.map((p) => ({ ...p, status: "completed" })));
        }
        // Small delay so the user sees 100% before switching to output view
        setTimeout(() => onComplete(), 1000);
        break;
      }
    }
  }, [onComplete]);

  // SSE connection
  useEffect(() => {
    sseErrorCountRef.current = 0;

    const cleanup = streamReviewProgress(
      reviewId,
      (event) => {
        sseErrorCountRef.current = 0; // Reset on successful event
        setSseConnected(true);
        handleEvent(event);
      },
      (_error, source) => {
        sseErrorCountRef.current += 1;

        // EventSource fires onerror on every reconnection attempt — that's
        // normal behaviour per the spec. Only fall back to polling when:
        //  1. The connection is permanently CLOSED, or
        //  2. We've seen multiple consecutive errors with no successful events
        if (
          source.readyState === EventSource.CLOSED ||
          sseErrorCountRef.current >= SSE_MAX_ERRORS
        ) {
          setSseConnected(false);
          setFallbackPolling(true);
          source.close();
        }
        // Otherwise let EventSource auto-reconnect
      },
    );

    return cleanup;
  }, [reviewId, handleEvent]);

  // Fallback polling (only if SSE fails)
  useEffect(() => {
    if (!fallbackPolling || sseConnected) return;

    const interval = setInterval(async () => {
      try {
        const status = await getReviewStatus(reviewId);
        if (status.status === "completed" || status.status === "error") {
          onComplete();
        }
      } catch {
        // Non-fatal
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fallbackPolling, sseConnected, reviewId, onComplete]);

  const activeExplorers = subagents.filter((s) => s.agentType === "codebase-explorer");
  const webResearcher = subagents.find((s) => s.agentType === "web-researcher");
  const exploringAgents = subagents.filter(
    (s) => s.agentType === "codebase-explorer" || s.agentType === "web-researcher",
  );
  const completedExploringCount = exploringAgents.filter((s) => s.status === "completed").length;

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/50 p-5">
      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span>{progressMessage}</span>
          <span className="font-mono">{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Phase stepper */}
      <div className="space-y-2">
        {phases.map((phase) => (
          <div key={phase.key} className="flex items-start gap-2.5">
            {/* Status icon */}
            <div className="mt-0.5 flex-shrink-0">
              {phase.status === "completed" && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              {phase.status === "active" && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-500 bg-white">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                </div>
              )}
              {phase.status === "pending" && (
                <div className="h-5 w-5 rounded-full border-2 border-gray-300 bg-white" />
              )}
            </div>

            {/* Phase content */}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${
                phase.status === "active" ? "text-blue-800" :
                phase.status === "completed" ? "text-green-700" :
                "text-gray-400"
              }`}>
                {phase.label}
                {phase.key === "exploring" && exploringAgents.length > 0 && (
                  <span className="ml-1 font-normal">
                    ({completedExploringCount}/{exploringAgents.length} complete)
                  </span>
                )}
              </p>

              {/* Subagent details for exploring phase */}
              {phase.key === "exploring" && phase.status !== "pending" && exploringAgents.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {webResearcher && (
                    <div className="flex items-center gap-1.5 text-xs text-purple-600">
                      {webResearcher.status === "completed" ? (
                        <span className="text-green-500">&#10003;</span>
                      ) : (
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" />
                      )}
                      <span className="truncate">Web research: {webResearcher.description}</span>
                    </div>
                  )}
                  {activeExplorers.map((sub, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                      {sub.status === "completed" ? (
                        <span className="text-green-500">&#10003;</span>
                      ) : (
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                      )}
                      <span className="truncate">{sub.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {phase.message && phase.status === "active" && (
                <p className="mt-0.5 text-xs text-gray-500">{phase.message}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Activity feed */}
      {activities.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-1.5">
            <p className="text-xs font-medium text-gray-500">Activity</p>
          </div>
          <div className="max-h-36 overflow-y-auto px-3 py-2 font-mono text-xs text-gray-600">
            {activities.map((a, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="flex-shrink-0 text-gray-400">
                  {new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="text-blue-600">{a.tool}</span>
                <span className="truncate">{a.detail}</span>
              </div>
            ))}
            <div ref={activityEndRef} />
          </div>
        </div>
      )}

      {/* Token usage (live) */}
      {sessionTokens && (
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">Token Usage</p>
              <p className="text-xs font-medium text-gray-500">
                ~${costUsd.toFixed(4)}
              </p>
            </div>
          </div>
          <div className="px-3 py-2 text-xs">
            {/* Session totals */}
            <div className="flex items-center justify-between text-gray-600">
              <span className="font-medium">Session total</span>
              <span className="font-mono">
                {formatTokens(sessionTokens.inputTokens)} in / {formatTokens(sessionTokens.outputTokens)} out
              </span>
            </div>

            {/* Per-subagent */}
            {subagentUsages.length > 0 && (
              <div className="mt-1.5 space-y-0.5 border-t border-gray-100 pt-1.5">
                {subagentUsages.map((sub, i) => (
                  <div key={i} className="flex items-center justify-between text-gray-500">
                    <span className="truncate pr-2">{sub.description}</span>
                    <span className="flex-shrink-0 font-mono">
                      {formatTokens(sub.usage.inputTokens)} in / {formatTokens(sub.usage.outputTokens)} out
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fallback indicator */}
      {fallbackPolling && !sseConnected && (
        <p className="text-center text-xs text-gray-400">
          Live updates unavailable — polling for status...
        </p>
      )}
    </div>
  );
}
