import { useState, useCallback, useRef } from "react";
import { createReview } from "../api/client";

interface FileUploadProps {
  onReviewCreated: () => void;
}

const SOURCE_LABELS = [
  "Design Doc",
  "Tech Spec",
  "User Research",
  "Meeting Notes",
  "API Contract",
  "Architecture Doc",
  "Other",
] as const;

interface SupplementaryEntry {
  file: File;
  label: string;
}

export default function FileUpload({ onReviewCreated }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [repoPaths, setRepoPaths] = useState("");
  const [supplementaryFiles, setSupplementaryFiles] = useState<SupplementaryEntry[]>([]);
  const [additionalContext, setAdditionalContext] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [suppDragOver, setSuppDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleSuppDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setSuppDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const entries: SupplementaryEntry[] = files.map((f) => ({ file: f, label: "" }));
      setSupplementaryFiles((prev) => [...prev, ...entries]);
    }
  }, []);

  const handleSuppFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const entries: SupplementaryEntry[] = files.map((f) => ({ file: f, label: "" }));
      setSupplementaryFiles((prev) => [...prev, ...entries]);
    }
    // Reset input so re-selecting the same file works
    if (suppInputRef.current) suppInputRef.current.value = "";
  }, []);

  const removeSuppFile = useCallback((index: number) => {
    setSupplementaryFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateSuppLabel = useCallback((index: number, label: string) => {
    setSupplementaryFiles((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, label } : entry)),
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const paths = repoPaths
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    if (paths.length === 0) {
      setError("Please specify at least one repository path.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const suppForApi = supplementaryFiles.length > 0
        ? supplementaryFiles.map((s) => ({ file: s.file, label: s.label || undefined }))
        : undefined;
      const context = additionalContext.trim() || undefined;

      await createReview(file, paths, suppForApi, context);
      setFile(null);
      setRepoPaths("");
      setSupplementaryFiles([]);
      setAdditionalContext("");
      setShowSources(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onReviewCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const hasSourceContent = supplementaryFiles.length > 0 || additionalContext.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* PRD drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : file
              ? "border-green-300 bg-green-50"
              : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.pdf,.docx,.markdown"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="hidden"
        />
        {file ? (
          <div>
            <p className="text-sm font-medium text-green-700">{file.name}</p>
            <p className="mt-1 text-xs text-gray-500">
              {(file.size / 1024).toFixed(1)} KB — click or drop to replace
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600">
              Drop your PRD here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Supports .md, .txt, .pdf, .docx
            </p>
          </div>
        )}
      </div>

      {/* Repo paths */}
      <div>
        <label
          htmlFor="repoPaths"
          className="block text-sm font-medium text-gray-700"
        >
          Repository path(s)
        </label>
        <textarea
          id="repoPaths"
          value={repoPaths}
          onChange={(e) => setRepoPaths(e.target.value)}
          placeholder={"/path/to/your/repo\n/path/to/another/repo"}
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          One absolute path per line. The agent will explore these codebases.
        </p>
      </div>

      {/* Reference Sources (collapsible) */}
      <div className="rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={() => setShowSources(!showSources)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">Reference Sources</span>
            <span className="text-xs text-gray-400">(optional)</span>
            {hasSourceContent && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {supplementaryFiles.length > 0 && `${supplementaryFiles.length} file${supplementaryFiles.length > 1 ? "s" : ""}`}
                {supplementaryFiles.length > 0 && additionalContext.trim() && " + "}
                {additionalContext.trim() && "context"}
              </span>
            )}
          </div>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${showSources ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showSources && (
          <div className="space-y-3 border-t border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500">
              Add design docs, tech specs, meeting notes, or other reference
              material that provides context on <strong>the why</strong> and{" "}
              <strong>the what</strong> behind this PRD.
            </p>

            {/* Supplementary file drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setSuppDragOver(true);
              }}
              onDragLeave={() => setSuppDragOver(false)}
              onDrop={handleSuppDrop}
              onClick={() => suppInputRef.current?.click()}
              className={`cursor-pointer rounded-md border-2 border-dashed p-4 text-center transition-colors ${
                suppDragOver
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                ref={suppInputRef}
                type="file"
                accept=".md,.txt,.pdf,.docx,.markdown"
                multiple
                onChange={handleSuppFileChange}
                className="hidden"
              />
              <p className="text-xs text-gray-500">
                Drop files here or click to browse
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                .md, .txt, .pdf, .docx — up to 10 files
              </p>
            </div>

            {/* Supplementary file list */}
            {supplementaryFiles.length > 0 && (
              <div className="space-y-2">
                {supplementaryFiles.map((entry, i) => (
                  <div
                    key={`${entry.file.name}-${i}`}
                    className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2"
                  >
                    {/* File info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-gray-700">
                        {entry.file.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {(entry.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>

                    {/* Label selector */}
                    <select
                      value={entry.label}
                      onChange={(e) => updateSuppLabel(i, e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="">Label...</option>
                      {SOURCE_LABELS.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeSuppFile(i)}
                      className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Additional context textarea */}
            <div>
              <label
                htmlFor="additionalContext"
                className="block text-xs font-medium text-gray-600"
              >
                Additional context
              </label>
              <textarea
                id="additionalContext"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="Paste any additional context — meeting notes, links, design rationale, background info..."
                rows={3}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-xs shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!file || loading}
        className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Processing..." : "Do your magic"}
      </button>
    </form>
  );
}
