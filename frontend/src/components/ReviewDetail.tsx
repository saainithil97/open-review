import { useState, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getReview, getReviewStatus, rerunReview } from "../api/client";
import type { ReviewDetail as ReviewDetailType, SessionUsage } from "../api/client";
import StatusBadge from "./StatusBadge";
import ProgressPanel from "./ProgressPanel";

interface ReviewDetailProps {
  reviewId: string;
  onUpdate: () => void;
}

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

function UsageSummary({ usage }: { usage: SessionUsage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
      >
        <div className="flex items-center gap-4 text-gray-600">
          <span className="font-medium">Usage Summary</span>
          <span className="font-mono text-xs">
            ${usage.totalCostUsd.toFixed(4)}
          </span>
          <span className="text-xs text-gray-400">
            {formatTokens(usage.totalTokens.inputTokens)} in / {formatTokens(usage.totalTokens.outputTokens)} out
          </span>
          <span className="text-xs text-gray-400">
            {formatDuration(usage.durationMs)}
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 text-xs">
          {/* Overall stats */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
            <div>
              <span className="text-gray-400">Total Cost</span>
              <p className="font-mono font-medium text-gray-700">${usage.totalCostUsd.toFixed(4)}</p>
            </div>
            <div>
              <span className="text-gray-400">Duration</span>
              <p className="font-mono font-medium text-gray-700">
                {formatDuration(usage.durationMs)}
                {usage.durationApiMs > 0 && (
                  <span className="font-normal text-gray-400"> (API: {formatDuration(usage.durationApiMs)})</span>
                )}
              </p>
            </div>
            <div>
              <span className="text-gray-400">Turns</span>
              <p className="font-mono font-medium text-gray-700">{usage.numTurns}</p>
            </div>
            <div>
              <span className="text-gray-400">Total Tokens</span>
              <p className="font-mono font-medium text-gray-700">
                {formatTokens(usage.totalTokens.inputTokens)} in / {formatTokens(usage.totalTokens.outputTokens)} out
              </p>
            </div>
          </div>

          {/* Cache stats */}
          {(usage.totalTokens.cacheReadTokens > 0 || usage.totalTokens.cacheCreationTokens > 0) && (
            <div className="mt-2 text-gray-400">
              Cache: {formatTokens(usage.totalTokens.cacheReadTokens)} read, {formatTokens(usage.totalTokens.cacheCreationTokens)} created
            </div>
          )}

          {/* Per-agent breakdown */}
          {usage.subagentBreakdown.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 font-medium text-gray-500">Per Agent</p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1 pr-4 font-normal">Agent</th>
                    <th className="pb-1 pr-4 font-normal">Model</th>
                    <th className="pb-1 pr-4 text-right font-normal">Input</th>
                    <th className="pb-1 text-right font-normal">Output</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-gray-600">
                  {usage.subagentBreakdown.map((sub, i) => (
                    <tr key={i}>
                      <td className="pr-4 py-0.5">{sub.description}</td>
                      <td className="pr-4 py-0.5 text-gray-400">{sub.model}</td>
                      <td className="pr-4 py-0.5 text-right">{formatTokens(sub.usage.inputTokens)}</td>
                      <td className="py-0.5 text-right">{formatTokens(sub.usage.outputTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Per-model breakdown */}
          {Object.keys(usage.modelBreakdown).length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 font-medium text-gray-500">Per Model</p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1 pr-4 font-normal">Model</th>
                    <th className="pb-1 pr-4 text-right font-normal">Cost</th>
                    <th className="pb-1 pr-4 text-right font-normal">Input</th>
                    <th className="pb-1 pr-4 text-right font-normal">Output</th>
                    <th className="pb-1 text-right font-normal">Context Window</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-gray-600">
                  {Object.entries(usage.modelBreakdown).map(([model, data]) => (
                    <tr key={model}>
                      <td className="pr-4 py-0.5 max-w-48 truncate">{model}</td>
                      <td className="pr-4 py-0.5 text-right">${data.costUsd.toFixed(4)}</td>
                      <td className="pr-4 py-0.5 text-right">{formatTokens(data.inputTokens)}</td>
                      <td className="pr-4 py-0.5 text-right">{formatTokens(data.outputTokens)}</td>
                      <td className="py-0.5 text-right">{formatTokens(data.contextWindow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReviewDetail({ reviewId, onUpdate }: ReviewDetailProps) {
  const [review, setReview] = useState<ReviewDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReview = useCallback(async () => {
    try {
      const data = await getReview(reviewId);
      setReview(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchReview();
  }, [fetchReview]);

  // Poll for status while running (fallback — ProgressPanel handles SSE)
  useEffect(() => {
    if (!review || (review.status !== "running" && review.status !== "pending")) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const status = await getReviewStatus(reviewId);
        if (status.status !== review.status) {
          await fetchReview();
          onUpdate();
        }
      } catch {
        // Polling failure is non-fatal
      }
    }, 5000); // Slower poll since SSE is the primary update channel

    return () => clearInterval(interval);
  }, [review, reviewId, fetchReview, onUpdate]);

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await rerunReview(reviewId);
      await fetchReview();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rerun failed");
    } finally {
      setRerunning(false);
    }
  };

  const handleProgressComplete = useCallback(() => {
    fetchReview();
    onUpdate();
  }, [fetchReview, onUpdate]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading review...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!review) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {review.originalName}
          </h2>
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
            <StatusBadge status={review.status} />
            <span>
              Created{" "}
              {new Date(review.createdAt).toLocaleString()}
            </span>
            {review.completedAt && (
              <span>
                Completed{" "}
                {new Date(review.completedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-gray-400">
            Repos: {review.repoPaths.join(", ")}
          </div>
          {review.supplementaryFiles && review.supplementaryFiles.length > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              Sources:{" "}
              {review.supplementaryFiles.map((f) =>
                f.label ? `${f.originalName} (${f.label})` : f.originalName,
              ).join(", ")}
            </div>
          )}
          {review.additionalContext && (
            <div className="mt-1 text-xs text-gray-400">
              + additional context provided
            </div>
          )}
        </div>
        <button
          onClick={handleRerun}
          disabled={review.status === "running" || rerunning}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rerunning ? "Starting..." : "Re-run"}
        </button>
      </div>

      {/* Error message */}
      {review.status === "error" && review.error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Review failed</p>
          <p className="mt-1 text-sm text-red-700">{review.error}</p>
        </div>
      )}

      {/* Progress panel (replaces the old static spinner) */}
      {(review.status === "running" || review.status === "pending") && (
        <ProgressPanel
          reviewId={reviewId}
          onComplete={handleProgressComplete}
        />
      )}

      {/* Usage summary (for completed reviews) */}
      {review.status === "completed" && review.usage && (
        <UsageSummary usage={review.usage} />
      )}

      {/* Review output */}
      {review.reviewOutput && (
        <div className="prose prose-sm max-w-none rounded-lg border border-gray-200 bg-white p-6">
          <Markdown remarkPlugins={[remarkGfm]}>{review.reviewOutput}</Markdown>
        </div>
      )}
    </div>
  );
}
