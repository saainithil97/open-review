import "dotenv/config";
import express from "express";
import cors from "cors";
import reviewsRouter from "./routes/reviews.js";
import { logger } from "./utils/logger.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/reviews", reviewsRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`PRD Reviewer backend running on http://localhost:${PORT}`);

  if (process.env.ANTHROPIC_API_KEY) {
    logger.info("Using ANTHROPIC_API_KEY for authentication.");
  } else {
    logger.info(
      "No ANTHROPIC_API_KEY set — will use Claude Code CLI auth " +
      "(Claude Max / Pro subscription). Make sure 'claude' is logged in.",
    );
  }
});

// Disable default 2-minute timeout so long-lived SSE connections
// aren't terminated mid-review. Individual non-SSE routes still
// respond quickly, so this only affects idle keep-alive behaviour.
server.timeout = 0;
server.keepAliveTimeout = 0;
