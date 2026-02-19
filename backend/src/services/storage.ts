import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import type { ReviewMeta, ReviewDetail, ReviewStatus, SessionUsage, SupplementarySource } from "prd-reviewer-shared";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const OUTPUTS_DIR = path.join(DATA_DIR, "outputs");

async function ensureDirs(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_DIR, { recursive: true });
}

// ─── Review metadata (stored as JSON per review) ────────────────────────

function metaPath(id: string): string {
  return path.join(OUTPUTS_DIR, id, "meta.json");
}

function outputPath(id: string): string {
  return path.join(OUTPUTS_DIR, id, "review.md");
}

export function uploadedFilePath(id: string, fileName: string): string {
  return path.join(UPLOADS_DIR, `${id}_${fileName}`);
}

export function supplementaryFilePath(id: string, index: number, fileName: string): string {
  return path.join(UPLOADS_DIR, `${id}_supp_${index}_${fileName}`);
}

export async function createReview(
  originalName: string,
  fileName: string,
  repoPaths: string[],
  supplementaryFiles?: SupplementarySource[],
  additionalContext?: string,
  webSearchEnabled?: boolean,
): Promise<ReviewMeta> {
  await ensureDirs();
  const id = uuidv4();
  const meta: ReviewMeta = {
    id,
    fileName,
    originalName,
    repoPaths,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  if (supplementaryFiles && supplementaryFiles.length > 0) {
    meta.supplementaryFiles = supplementaryFiles;
  }
  if (additionalContext?.trim()) {
    meta.additionalContext = additionalContext.trim();
  }
  if (webSearchEnabled) {
    meta.webSearchEnabled = true;
  }

  const reviewDir = path.join(OUTPUTS_DIR, id);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  logger.info(`Created review ${id} for ${originalName} (${supplementaryFiles?.length ?? 0} supplementary files)`);
  return meta;
}

export async function getReviewMeta(id: string): Promise<ReviewMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(id), "utf-8");
    return JSON.parse(raw) as ReviewMeta;
  } catch {
    return null;
  }
}

export async function updateReviewStatus(
  id: string,
  status: ReviewStatus,
  error?: string,
): Promise<void> {
  const meta = await getReviewMeta(id);
  if (!meta) throw new Error(`Review ${id} not found`);

  meta.status = status;
  if (status === "completed" || status === "error") {
    meta.completedAt = new Date().toISOString();
  }
  if (error) meta.error = error;

  await fs.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  logger.info(`Updated review ${id} status to ${status}`);
}

export async function saveReviewOutput(id: string, markdown: string): Promise<void> {
  await fs.writeFile(outputPath(id), markdown, "utf-8");
  logger.info(`Saved review output for ${id}`);
}

export async function saveReviewUsage(id: string, usage: SessionUsage): Promise<void> {
  const meta = await getReviewMeta(id);
  if (!meta) throw new Error(`Review ${id} not found`);

  meta.usage = usage;
  await fs.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  logger.info(`Saved usage data for review ${id}: $${usage.totalCostUsd.toFixed(4)}`);
}

export async function getReviewDetail(id: string): Promise<ReviewDetail | null> {
  const meta = await getReviewMeta(id);
  if (!meta) return null;

  const detail: ReviewDetail = { ...meta };

  // Read the original PRD content
  const uploadPath = uploadedFilePath(id, meta.fileName);
  try {
    detail.prdContent = await fs.readFile(uploadPath, "utf-8");
  } catch {
    // File might be binary (docx/pdf), prdContent stays undefined
  }

  // Read supplementary file contents
  if (meta.supplementaryFiles && meta.supplementaryFiles.length > 0) {
    const suppContents: Array<{ name: string; label?: string; content: string }> = [];
    for (let i = 0; i < meta.supplementaryFiles.length; i++) {
      const sf = meta.supplementaryFiles[i];
      const sfPath = supplementaryFilePath(id, i, sf.fileName);
      try {
        const content = await fs.readFile(sfPath, "utf-8");
        suppContents.push({
          name: sf.originalName,
          label: sf.label,
          content,
        });
      } catch {
        // Binary file or missing — skip
      }
    }
    if (suppContents.length > 0) {
      detail.supplementaryContents = suppContents;
    }
  }

  // Read review output if it exists
  try {
    detail.reviewOutput = await fs.readFile(outputPath(id), "utf-8");
  } catch {
    // Not yet generated
  }

  return detail;
}

export async function listReviews(): Promise<ReviewMeta[]> {
  await ensureDirs();
  const entries = await fs.readdir(OUTPUTS_DIR, { withFileTypes: true });
  const reviews: ReviewMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await getReviewMeta(entry.name);
    if (meta) reviews.push(meta);
  }

  // Sort newest first
  reviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return reviews;
}

export async function getUploadedFileBuffer(id: string, fileName: string): Promise<Buffer> {
  const filePath = uploadedFilePath(id, fileName);
  return fs.readFile(filePath);
}
