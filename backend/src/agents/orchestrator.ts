import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { buildLeadAgentPrompt, CODEBASE_EXPLORER_PROMPT, SENIOR_DEVELOPER_PROMPT } from "./prompts.js";
import type { OrchestratorInput, OrchestratorResult } from "./types.js";
import type {
  ProgressEvent,
  ReviewPhase,
  TokenUsage,
  SubagentUsage,
  SessionUsage,
  ModelUsageData,
} from "prd-reviewer-shared";
import { logger } from "../utils/logger.js";

/** Map model shorthand to full model ID for the top-level query. */
const MODEL_MAP: Record<string, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-20250514",
  haiku: "claude-haiku-3-5-20241022",
};

/** Create an empty TokenUsage object. */
function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

/** Add token counts from an API message usage object to our accumulator. */
function addUsage(
  acc: TokenUsage,
  apiUsage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined,
): void {
  if (!apiUsage) return;
  acc.inputTokens += apiUsage.input_tokens ?? 0;
  acc.outputTokens += apiUsage.output_tokens ?? 0;
  acc.cacheReadTokens += apiUsage.cache_read_input_tokens ?? 0;
  acc.cacheCreationTokens += apiUsage.cache_creation_input_tokens ?? 0;
}

/**
 * Run the full PRD review pipeline:
 *   Lead Agent -> Codebase Explorers (parallel) -> Senior Developer -> Synthesis
 *
 * The lead agent orchestrates everything via the Task tool.
 * We set up the agents and the lead's prompt, then let it work,
 * emitting progress events along the way.
 */
export async function runReview(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { prdContent, supplementarySources, additionalContext, repoPaths, config, onProgress } = input;

  logger.info("Starting PRD review pipeline", {
    repoPaths,
    models: config,
    prdLength: prdContent.length,
    supplementarySources: supplementarySources?.length ?? 0,
    hasAdditionalContext: !!additionalContext,
  });

  // ─── Emit helper ────────────────────────────────────────────────────
  function emit(event: ProgressEvent): void {
    onProgress?.(event);
  }

  function now(): string {
    return new Date().toISOString();
  }

  // ─── Define subagents ───────────────────────────────────────────────
  const agents: Record<string, AgentDefinition> = {
    "codebase-explorer": {
      description:
        "Codebase exploration specialist. Use this agent to search and analyze a repository " +
        "for code relevant to a specific PRD section. Launch one explorer per PRD section — " +
        "they run in parallel. Each explorer should receive: the PRD section text, specific " +
        "technical questions to answer, and the repo path(s) to search.",
      prompt: CODEBASE_EXPLORER_PROMPT,
      tools: ["Read", "Glob", "Grep"],
      model: config.explorerModel,
    },
    "senior-developer": {
      description:
        "Senior developer for feasibility analysis. Use this agent AFTER all codebase " +
        "explorers have reported back. Pass it the full PRD text and consolidated explorer " +
        "findings. It will analyze feasibility, identify gaps, estimate complexity, and " +
        "flag technical risks.",
      prompt: SENIOR_DEVELOPER_PROMPT,
      tools: ["Read", "Glob", "Grep"],
      model: config.seniorDevModel,
    },
  };

  const leadPrompt = buildLeadAgentPrompt(prdContent, repoPaths, supplementarySources, additionalContext);

  // ─── Phase tracking state ───────────────────────────────────────────
  let currentPhase: ReviewPhase = "understanding";
  let totalExplorers = 0;
  let completedExplorers = 0;
  let seniorDevStarted = false;
  let seniorDevCompleted = false;

  // Maps tool_use_id -> subagent info (so we can match completions)
  const taskMap = new Map<string, { agentType: string; description: string }>();

  // ─── Token usage tracking ──────────────────────────────────────────
  const sessionTokens = emptyTokenUsage();
  const leadAgentTokens = emptyTokenUsage();
  // Per-subagent usage: tool_use_id -> { info + tokens }
  const subagentTokens = new Map<string, { agentType: string; description: string; model: string; usage: TokenUsage }>();

  // Activity throttle: agentKey -> last emit time
  const activityThrottle = new Map<string, number>();
  const ACTIVITY_THROTTLE_MS = 1000;

  // Periodic usage emission
  let lastUsageEmitTime = 0;
  const USAGE_EMIT_INTERVAL_MS = 5000;

  function emitPhase(phase: ReviewPhase, message: string): void {
    currentPhase = phase;
    emit({ type: "phase", timestamp: now(), data: { phase, message } });
  }

  function emitProgress(): void {
    let percent: number;
    let message: string;

    switch (currentPhase) {
      case "understanding":
        percent = 5;
        message = "Reading and understanding the PRD...";
        break;
      case "exploring":
        percent = totalExplorers > 0
          ? Math.round(10 + 50 * (completedExplorers / totalExplorers))
          : 15;
        message = totalExplorers > 0
          ? `Exploring codebase (${completedExplorers}/${totalExplorers} complete)`
          : "Exploring codebase...";
        break;
      case "analyzing":
        percent = seniorDevCompleted ? 85 : 70;
        message = seniorDevCompleted
          ? "Analysis complete, preparing final output..."
          : "Senior developer analyzing findings...";
        break;
      case "synthesizing":
        percent = 92;
        message = "Synthesizing final review...";
        break;
    }

    emit({ type: "progress", timestamp: now(), data: { percent, message } });
  }

  function emitUsageIfDue(): void {
    const elapsed = Date.now() - lastUsageEmitTime;
    if (elapsed < USAGE_EMIT_INTERVAL_MS) return;
    lastUsageEmitTime = Date.now();

    const subagents: SubagentUsage[] = [];
    for (const [, v] of subagentTokens) {
      subagents.push({
        agentType: v.agentType,
        description: v.description,
        usage: { ...v.usage },
        model: v.model,
      });
    }

    let costEstimate = 0;
    // Rough cost estimate based on token counts (sonnet pricing ~$3/M in, $15/M out)
    costEstimate += sessionTokens.inputTokens * 3 / 1_000_000;
    costEstimate += sessionTokens.outputTokens * 15 / 1_000_000;

    emit({
      type: "usage",
      timestamp: now(),
      data: {
        session: { ...sessionTokens },
        subagents,
        costUsd: costEstimate,
      },
    });
  }

  // ─── Run the orchestration ──────────────────────────────────────────
  let finalResult = "";
  let totalCostUsd = 0;
  let durationMs = 0;
  let durationApiMs = 0;
  let numTurns = 0;
  let modelUsageRaw: Record<string, unknown> = {};

  const startTime = Date.now();

  emitPhase("understanding", "Reading and understanding the PRD...");
  emitProgress();

  try {
    for await (const message of query({
      prompt: leadPrompt,
      options: {
        allowedTools: ["Task"],
        permissionMode: "bypassPermissions",
        model: MODEL_MAP[config.leadModel] ?? MODEL_MAP.sonnet,
        agents,
        maxTurns: 60,
        additionalDirectories: repoPaths,
      },
    })) {
      // ─── System init ──────────────────────────────────────────
      if (message.type === "system" && message.subtype === "init") {
        logger.info("Agent session initialized", { sessionId: message.session_id });
        continue;
      }

      // ─── Assistant messages (lead + subagents) ────────────────
      if (message.type === "assistant" && message.message) {
        const parentToolUseId = message.parent_tool_use_id;
        const apiMsg = message.message as {
          content?: Array<Record<string, unknown>>;
          usage?: Record<string, number>;
          model?: string;
        };

        // Accumulate token usage
        if (apiMsg.usage) {
          addUsage(sessionTokens, apiMsg.usage as Parameters<typeof addUsage>[1]);

          if (parentToolUseId === null) {
            // Lead agent message
            addUsage(leadAgentTokens, apiMsg.usage as Parameters<typeof addUsage>[1]);
          } else if (parentToolUseId) {
            // Subagent message
            const subEntry = subagentTokens.get(parentToolUseId);
            if (subEntry) {
              addUsage(subEntry.usage, apiMsg.usage as Parameters<typeof addUsage>[1]);
            }
          }
        }

        // Process content blocks for phase detection + activity
        if (apiMsg.content) {
          for (const block of apiMsg.content) {
            // ─── Lead agent text output ────────────────────────
            if (block.type === "text" && block.text && parentToolUseId === null) {
              logger.debug("Lead agent text:", String(block.text).substring(0, 200));

              // If senior dev is done and lead is writing text, we're synthesizing
              if (seniorDevCompleted && (currentPhase as ReviewPhase) !== "synthesizing") {
                emitPhase("synthesizing", "Synthesizing final review...");
                emitProgress();
              }
            }

            // ─── Task tool invocations (lead launching subagents) ──
            if (block.type === "tool_use" && block.name === "Task") {
              const toolInput = block.input as Record<string, unknown>;
              const toolUseId = block.id as string;
              const agentType = String(toolInput.subagent_type ?? "unknown");
              const description = String(toolInput.description ?? "");

              // Track this task
              taskMap.set(toolUseId, { agentType, description });

              // Create subagent usage tracker
              subagentTokens.set(toolUseId, {
                agentType,
                description,
                model: agentType === "codebase-explorer"
                  ? (config.explorerModel || "sonnet")
                  : (config.seniorDevModel || "sonnet"),
                usage: emptyTokenUsage(),
              });

              // Phase detection
              if (agentType === "codebase-explorer") {
                totalExplorers++;
                if (currentPhase === "understanding") {
                  emitPhase("exploring", `Exploring codebase (0/${totalExplorers} sections)...`);
                }
                logger.info(`Launched codebase-explorer: ${description}`);
              } else if (agentType === "senior-developer") {
                seniorDevStarted = true;
                emitPhase("analyzing", "Senior developer analyzing findings...");
                logger.info(`Launched senior-developer: ${description}`);
              }

              emit({
                type: "subagent",
                timestamp: now(),
                data: { agentType, description, status: "started" },
              });
              emitProgress();
            }

            // ─── Subagent tool usage (activity events) ──────────
            if (block.type === "tool_use" && parentToolUseId) {
              const toolName = String(block.name ?? "");
              const toolInput = block.input as Record<string, unknown>;
              const subInfo = taskMap.get(parentToolUseId);
              const agentKey = parentToolUseId;

              // Throttle: max 1 activity per agent per second
              const lastEmit = activityThrottle.get(agentKey) ?? 0;
              if (Date.now() - lastEmit >= ACTIVITY_THROTTLE_MS) {
                activityThrottle.set(agentKey, Date.now());

                let detail = "";
                if (toolName === "Read" && toolInput.file_path) {
                  detail = String(toolInput.file_path);
                } else if (toolName === "Grep" && toolInput.pattern) {
                  detail = `pattern: "${toolInput.pattern}"`;
                } else if (toolName === "Glob" && toolInput.pattern) {
                  detail = `pattern: ${toolInput.pattern}`;
                }

                if (detail) {
                  emit({
                    type: "activity",
                    timestamp: now(),
                    data: {
                      agentType: subInfo?.agentType ?? "unknown",
                      tool: toolName,
                      detail,
                    },
                  });
                }
              }
            }
          }
        }

        emitUsageIfDue();
        continue;
      }

      // ─── User messages (tool results flowing back) ────────────
      if (message.type === "user" && message.message) {
        const userMsg = message.message as {
          content?: Array<Record<string, unknown>>;
        };

        // Check for Task tool results (subagent completions)
        if (userMsg.content) {
          for (const block of userMsg.content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const toolUseId = String(block.tool_use_id);
              const subInfo = taskMap.get(toolUseId);

              if (subInfo) {
                if (subInfo.agentType === "codebase-explorer") {
                  completedExplorers++;
                  logger.info(
                    `Explorer completed (${completedExplorers}/${totalExplorers}): ${subInfo.description}`,
                  );
                } else if (subInfo.agentType === "senior-developer") {
                  seniorDevCompleted = true;
                  logger.info("Senior developer analysis completed");
                }

                emit({
                  type: "subagent",
                  timestamp: now(),
                  data: { agentType: subInfo.agentType, description: subInfo.description, status: "completed" },
                });
                emitProgress();

                // Force usage emit on subagent completion
                lastUsageEmitTime = 0;
                emitUsageIfDue();
              }
            }
          }
        }
        continue;
      }

      // ─── Final result ─────────────────────────────────────────
      if (message.type === "result") {
        const resultMsg = message as Record<string, unknown>;

        if (resultMsg.subtype === "success") {
          finalResult = String(resultMsg.result ?? "");
          totalCostUsd = Number(resultMsg.total_cost_usd ?? 0);
          durationApiMs = Number(resultMsg.duration_api_ms ?? 0);
          numTurns = Number(resultMsg.num_turns ?? 0);

          // Capture model usage breakdown
          if (resultMsg.modelUsage && typeof resultMsg.modelUsage === "object") {
            modelUsageRaw = resultMsg.modelUsage as Record<string, unknown>;
          }
        } else {
          const errors = Array.isArray(resultMsg.errors) ? resultMsg.errors : [];
          totalCostUsd = Number(resultMsg.total_cost_usd ?? 0);
          throw new Error(
            `Agent failed with subtype: ${String(resultMsg.subtype)}. Errors: ${JSON.stringify(errors)}`,
          );
        }
      }
    }
  } catch (error) {
    logger.error("Agent orchestration failed:", error);

    // Emit error completion
    emit({
      type: "complete",
      timestamp: now(),
      data: { status: "error", message: error instanceof Error ? error.message : "Unknown error" },
    });

    throw error;
  }

  durationMs = Date.now() - startTime;

  // ─── Build session usage summary ────────────────────────────────────
  const modelBreakdown: Record<string, ModelUsageData> = {};
  for (const [modelName, rawData] of Object.entries(modelUsageRaw)) {
    const data = rawData as Record<string, number>;
    modelBreakdown[modelName] = {
      inputTokens: data.inputTokens ?? 0,
      outputTokens: data.outputTokens ?? 0,
      cacheReadTokens: data.cacheReadInputTokens ?? 0,
      cacheCreationTokens: data.cacheCreationInputTokens ?? 0,
      costUsd: data.costUSD ?? 0,
      contextWindow: data.contextWindow ?? 0,
    };
  }

  const subagentBreakdown: SubagentUsage[] = [];

  // Add lead agent as first entry
  subagentBreakdown.push({
    agentType: "lead-agent",
    description: "Tech Lead (orchestrator)",
    usage: { ...leadAgentTokens },
    model: config.leadModel,
  });

  // Add subagents
  for (const [, v] of subagentTokens) {
    subagentBreakdown.push({
      agentType: v.agentType,
      description: v.description,
      usage: { ...v.usage },
      model: v.model,
    });
  }

  const sessionUsage: SessionUsage = {
    totalCostUsd,
    totalTokens: { ...sessionTokens },
    modelBreakdown,
    subagentBreakdown,
    numTurns,
    durationMs,
    durationApiMs,
  };

  logger.info(
    `PRD review completed in ${durationMs}ms, cost: $${totalCostUsd.toFixed(4)}, ` +
    `tokens: ${sessionTokens.inputTokens} in / ${sessionTokens.outputTokens} out`,
  );

  // Emit completion with progress = 100%
  emit({ type: "progress", timestamp: now(), data: { percent: 100, message: "Review complete!" } });
  emit({ type: "complete", timestamp: now(), data: { status: "completed" } });

  return {
    output: finalResult,
    costUsd: totalCostUsd,
    durationMs,
    usage: sessionUsage,
  };
}
