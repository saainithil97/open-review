import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { logger } from "../utils/logger.js";

export type SupportedExtension = ".md" | ".markdown" | ".txt" | ".pdf" | ".docx";

const SUPPORTED_EXTENSIONS: Set<string> = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx",
]);

export function isSupportedFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function getSafeFileName(originalName: string): string {
  // Sanitize: keep alphanumeric, dots, hyphens, underscores
  return originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Parse an uploaded file into plain text content.
 * Supports .md, .markdown, .txt, .pdf, .docx
 */
export async function parseFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  logger.info(`Parsing file: ${filePath} (ext: ${ext})`);

  switch (ext) {
    case ".md":
    case ".markdown":
    case ".txt":
      return fs.readFile(filePath, "utf-8");

    case ".docx":
      return parseDocx(filePath);

    case ".pdf":
      return parsePdf(filePath);

    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

async function parseDocx(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  if (result.messages.length > 0) {
    logger.warn("Docx parsing warnings:", result.messages);
  }
  return result.value;
}

async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}
