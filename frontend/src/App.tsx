import { useState, useEffect, useCallback } from "react";
import FileUpload from "./components/FileUpload";
import ReviewList from "./components/ReviewList";
import ReviewDetail from "./components/ReviewDetail";
import { listReviews } from "./api/client";
import type { ReviewMeta } from "./api/client";

export default function App() {
  const [reviews, setReviews] = useState<ReviewMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReviews = useCallback(async () => {
    try {
      const data = await listReviews();
      setReviews(data);
    } catch (err) {
      console.error("Failed to fetch reviews:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleReviewCreated = () => {
    fetchReviews();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <h1 className="text-xl font-bold text-gray-900">PRD Reviewer</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Upload a PRD and let agents review it against your codebase
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left panel: Upload + Review list */}
          <div className="lg:col-span-4 space-y-6">
            {/* Upload card */}
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-gray-900">
                New Review
              </h2>
              <FileUpload onReviewCreated={handleReviewCreated} />
            </div>

            {/* Review list card */}
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  Reviews
                  {reviews.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      ({reviews.length})
                    </span>
                  )}
                </h2>
              </div>
              {loading ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  Loading...
                </div>
              ) : (
                <ReviewList
                  reviews={reviews}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </div>
          </div>

          {/* Right panel: Review detail */}
          <div className="lg:col-span-8">
            {selectedId ? (
              <ReviewDetail
                key={selectedId}
                reviewId={selectedId}
                onUpdate={fetchReviews}
              />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed border-gray-200">
                <p className="text-sm text-gray-400">
                  Select a review to view its details
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
