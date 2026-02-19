import type { ReviewStatus } from "../api/client";

const STATUS_STYLES: Record<ReviewStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  running: "Running...",
  completed: "Completed",
  error: "Error",
};

interface StatusBadgeProps {
  status: ReviewStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status === "running" && (
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}
