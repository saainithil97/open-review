import type { ReviewMeta } from "../api/client";
import StatusBadge from "./StatusBadge";

interface ReviewListProps {
  reviews: ReviewMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ReviewList({
  reviews,
  selectedId,
  onSelect,
}: ReviewListProps) {
  if (reviews.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No reviews yet. Upload a PRD to get started.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {reviews.map((review) => (
        <li key={review.id}>
          <button
            onClick={() => onSelect(review.id)}
            className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
              selectedId === review.id ? "bg-blue-50" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {review.originalName}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {new Date(review.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {review.usage && (
                    <span className="ml-2 font-mono text-gray-400">
                      ${review.usage.totalCostUsd.toFixed(4)}
                    </span>
                  )}
                </p>
              </div>
              <StatusBadge status={review.status} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
