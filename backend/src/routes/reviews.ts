import { Router } from "express";
import { EventEmitter } from "events";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import type { AgentModelChoice, ProgressEvent, SupplementarySource } from "prd-reviewer-shared";
import {
  createReview,
  getReviewMeta,
  getReviewDetail,
  listReviews,
  updateReviewStatus,
  saveReviewOutput,
  saveReviewUsage,
  uploadedFilePath,
  supplementaryFilePath,
} from "../services/storage.js";
import { parseFile, isSupportedFile, getSafeFileName } from "../services/fileParser.js";
import { runReview } from "../agents/orchestrator.js";
import { logger } from "../utils/logger.js";

const router = Router();

// ─── SSE event emitters for active reviews ──────────────────────────────

const reviewEmitters = new Map<string, EventEmitter>();

// ─── Multer config ──────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    if (isSupportedFile(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Accepted: .md, .txt, .pdf, .docx"));
    }
  },
});

function getAgentConfig() {
  return {
    leadModel: (process.env.LEAD_AGENT_MODEL || "sonnet") as AgentModelChoice,
    explorerModel: (process.env.EXPLORER_AGENT_MODEL || "sonnet") as AgentModelChoice,
    seniorDevModel: (process.env.SENIOR_DEV_AGENT_MODEL || "sonnet") as AgentModelChoice,
  };
}

// ─── POST /api/reviews — Upload a PRD and start review ──────────────────

const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "supplementaryFiles", maxCount: 10 },
]);

router.post("/", uploadFields, async (req, res) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const prdFile = files?.["file"]?.[0];

    if (!prdFile) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const rawPaths = req.body.repoPaths;
    let repoPaths: string[];
    if (typeof rawPaths === "string") {
      try {
        repoPaths = JSON.parse(rawPaths);
      } catch {
        repoPaths = rawPaths.split(",").map((p: string) => p.trim()).filter(Boolean);
      }
    } else if (Array.isArray(rawPaths)) {
      repoPaths = rawPaths;
    } else {
      res.status(400).json({ error: "repoPaths is required (array of repo paths)" });
      return;
    }

    if (repoPaths.length === 0) {
      res.status(400).json({ error: "At least one repo path is required" });
      return;
    }

    // Validate that repo paths exist
    for (const rp of repoPaths) {
      try {
        await fs.access(rp);
      } catch {
        res.status(400).json({ error: `Repository path not found: ${rp}` });
        return;
      }
    }

    // Parse supplementary file labels
    const suppFiles = files?.["supplementaryFiles"] || [];
    let suppLabels: string[] = [];
    if (req.body.supplementaryLabels) {
      try {
        suppLabels = JSON.parse(req.body.supplementaryLabels);
      } catch {
        suppLabels = [];
      }
    }

    // Build supplementary metadata
    const supplementaryMeta: SupplementarySource[] = suppFiles.map((sf, i) => ({
      fileName: getSafeFileName(sf.originalname),
      originalName: sf.originalname,
      label: suppLabels[i] || undefined,
    }));

    const additionalContext: string | undefined = req.body.additionalContext?.trim() || undefined;
    const webSearchEnabled: boolean = req.body.webSearchEnabled === "true";

    const safeName = getSafeFileName(prdFile.originalname);
    const review = await createReview(
      prdFile.originalname,
      safeName,
      repoPaths,
      supplementaryMeta.length > 0 ? supplementaryMeta : undefined,
      additionalContext,
      webSearchEnabled || undefined,
    );

    // Save primary PRD file to disk
    const filePath = uploadedFilePath(review.id, safeName);
    await fs.writeFile(filePath, prdFile.buffer);

    // Save supplementary files to disk
    for (let i = 0; i < suppFiles.length; i++) {
      const sfPath = supplementaryFilePath(review.id, i, supplementaryMeta[i].fileName);
      await fs.writeFile(sfPath, suppFiles[i].buffer);
    }

    // Start the review process in the background
    startReviewProcess(review.id, filePath, repoPaths, supplementaryMeta, additionalContext, webSearchEnabled);

    res.status(201).json(review);
  } catch (error) {
    logger.error("Failed to create review:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// ─── GET /api/reviews — List all reviews ────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    const reviews = await listReviews();
    res.json(reviews);
  } catch (error) {
    logger.error("Failed to list reviews:", error);
    res.status(500).json({ error: "Failed to list reviews" });
  }
});

// ─── GET /api/reviews/:id/stream — SSE progress stream ─────────────────
// IMPORTANT: This must be registered BEFORE the /:id catch-all route.

router.get("/:id/stream", async (req, res) => {
  const reviewId = req.params.id;

  try {
    const meta = await getReviewMeta(reviewId);
    if (!meta) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    // Disable socket timeout for this long-lived SSE connection.
    // Node.js default is 2 minutes which kills the connection mid-review.
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // If review is already done, send immediate complete event and close
    if (meta.status === "completed" || meta.status === "error") {
      const event: ProgressEvent = {
        type: "complete",
        timestamp: new Date().toISOString(),
        data: {
          status: meta.status,
          message: meta.status === "error" ? meta.error : undefined,
        },
      };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
      return;
    }

    // Get or wait for the emitter
    const emitter = reviewEmitters.get(reviewId);
    if (!emitter) {
      // Review is pending but emitter not yet created — send a pending event
      const event: ProgressEvent = {
        type: "phase",
        timestamp: new Date().toISOString(),
        data: { phase: "understanding", message: "Waiting to start..." },
      };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // Subscribe to progress events
    const onProgress = (event: ProgressEvent) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client disconnected, will be cleaned up below
      }
    };

    // Listen on both the current emitter and any future one
    // (handles race condition where emitter is created after SSE connect)
    const currentEmitter = emitter;
    currentEmitter?.on("progress", onProgress);

    // If no emitter yet, poll for it
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    if (!currentEmitter) {
      pollInterval = setInterval(() => {
        const em = reviewEmitters.get(reviewId);
        if (em) {
          em.on("progress", onProgress);
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = null;
        }
      }, 500);
    }

    // Keepalive every 10 seconds — frequent enough to prevent proxy timeouts
    const keepalive = setInterval(() => {
      try {
        res.write(":keepalive\n\n");
      } catch {
        // Connection closed
      }
    }, 10000);

    // Cleanup on client disconnect
    req.on("close", () => {
      currentEmitter?.removeListener("progress", onProgress);
      // Also remove from any emitter we may have attached to later
      const laterEmitter = reviewEmitters.get(reviewId);
      if (laterEmitter && laterEmitter !== currentEmitter) {
        laterEmitter.removeListener("progress", onProgress);
      }
      clearInterval(keepalive);
      if (pollInterval) clearInterval(pollInterval);
    });
  } catch (error) {
    logger.error(`SSE stream error for ${reviewId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Stream setup failed" });
    }
  }
});

// ─── GET /api/reviews/:id/status — Poll review status ───────────────────

router.get("/:id/status", async (req, res) => {
  try {
    const meta = await getReviewMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json({ id: meta.id, status: meta.status, error: meta.error });
  } catch (error) {
    logger.error(`Failed to get status for ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ─── GET /api/reviews/:id — Get review detail ──────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const detail = await getReviewDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json(detail);
  } catch (error) {
    logger.error(`Failed to get review ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to get review" });
  }
});

// ─── POST /api/reviews/:id/rerun — Re-run a review ─────────────────────

router.post("/:id/rerun", async (req, res) => {
  try {
    const meta = await getReviewMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    if (meta.status === "running") {
      res.status(409).json({ error: "Review is already running" });
      return;
    }

    await updateReviewStatus(meta.id, "pending");

    const filePath = uploadedFilePath(meta.id, meta.fileName);
    startReviewProcess(
      meta.id,
      filePath,
      meta.repoPaths,
      meta.supplementaryFiles,
      meta.additionalContext,
      meta.webSearchEnabled,
    );

    const updated = await getReviewMeta(meta.id);
    res.json(updated);
  } catch (error) {
    logger.error(`Failed to rerun review ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to rerun review" });
  }
});

// ─── Background review process ──────────────────────────────────────────

function startReviewProcess(
  reviewId: string,
  filePath: string,
  repoPaths: string[],
  supplementaryMeta?: SupplementarySource[],
  additionalContext?: string,
  webSearchEnabled?: boolean,
): void {
  // Create event emitter for this review
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20); // Allow multiple SSE clients
  reviewEmitters.set(reviewId, emitter);

  // Fire and forget — runs in background
  (async () => {
    try {
      await updateReviewStatus(reviewId, "running");

      // Parse the uploaded PRD into plain text
      const prdContent = await parseFile(filePath);
      logger.info(`Parsed PRD for review ${reviewId}: ${prdContent.length} chars`);

      // Parse supplementary source files
      const supplementarySources: Array<{ name: string; label?: string; content: string }> = [];
      if (supplementaryMeta && supplementaryMeta.length > 0) {
        for (let i = 0; i < supplementaryMeta.length; i++) {
          const sf = supplementaryMeta[i];
          const sfPath = supplementaryFilePath(reviewId, i, sf.fileName);
          try {
            const content = await parseFile(sfPath);
            supplementarySources.push({
              name: sf.originalName,
              label: sf.label,
              content,
            });
            logger.info(`Parsed supplementary source ${i}: ${sf.originalName} (${content.length} chars)`);
          } catch (err) {
            logger.warn(`Failed to parse supplementary source ${sf.originalName}:`, err);
          }
        }
      }

      // Progress callback — forward to SSE emitter
      const onProgress = (event: ProgressEvent) => {
        emitter.emit("progress", event);
      };

      // Run the agent orchestration
      const result = await runReview({
        prdContent,
        supplementarySources: supplementarySources.length > 0 ? supplementarySources : undefined,
        additionalContext,
        webSearchEnabled,
        repoPaths,
        config: getAgentConfig(),
        onProgress,
      });

      // Save the output and usage
      await saveReviewOutput(reviewId, result.output);
      await saveReviewUsage(reviewId, result.usage);
      await updateReviewStatus(reviewId, "completed");

      logger.info(
        `Review ${reviewId} completed. Cost: $${result.costUsd.toFixed(4)}, ` +
        `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      logger.error(`Review ${reviewId} failed:`, error);
      const message = error instanceof Error ? error.message : "Unknown error";
      await updateReviewStatus(reviewId, "error", message).catch((e) =>
        logger.error("Failed to update error status:", e),
      );
    } finally {
      // Delay emitter cleanup so SSE clients have time to receive
      // the final "complete" event before the connection is torn down.
      setTimeout(() => {
        reviewEmitters.delete(reviewId);
        emitter.removeAllListeners();
      }, 3000);
    }
  })();
}

export default router;
