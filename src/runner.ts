import { promises as fs } from "node:fs";
import path from "node:path";
import { buildClient } from "./llm.ts";
import { toolDefinitions, toolHandlers } from "./tools.ts";
import type { Message } from "./types.ts";

export type RunnerOptions = {
  prompt: string;
  systemPrompt?: string;
  maxSteps?: number;
  provider?: string;
  model?: string;
  logJsonPath?: string | null;
  enableHumanLogs?: boolean;
  enableFileLogs?: boolean;
};

export async function runSteward(options: RunnerOptions) {
  const client = buildClient(options.provider ?? "echo", options.model ?? "gpt-4o-mini");
  const logger = createLogger({
    provider: options.provider ?? "echo",
    model: options.model ?? "gpt-4o-mini",
    logJsonPath: options.logJsonPath,
    enableHumanLogs: options.enableHumanLogs !== false,
    enableFileLogs: options.enableFileLogs !== false,
  });
  const messages: Message[] = [];

  const system = options.systemPrompt ?? defaultSystemPrompt();
  messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: options.prompt });

  const limit = options.maxSteps ?? 8;
  for (let step = 0; step < limit; step++) {
    const response = await client.generate(messages, toolDefinitions);
    await logger.json({
      type: "model_response",
      step,
      provider: options.provider ?? "echo",
      model: options.model ?? "gpt-4o-mini",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    if (response.toolCalls?.length) {
      logger.human(`model#${step} → tool calls: ${response.toolCalls.map((c) => c.name).join(", ")}`);
      messages.push({ role: "assistant", content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        const handler = toolHandlers[call.name];
        if (!handler) {
          messages.push({ role: "tool", content: `Unknown tool ${call.name}`, tool_call_id: call.id });
          continue;
        }
        logger.human(`tool#${step}:${call.name} args=${safeJson(call.arguments)}`);
        try {
          const result = await handler(call.arguments);
          logger.human(`tool#${step}:${call.name} -> ${result.output}`);
          await logger.json({
            type: "tool_result",
            step,
            tool: call.name,
            arguments: call.arguments,
            output: result.output,
            error: result.error === true,
          });
          messages.push({ role: "tool", content: result.output, tool_call_id: call.id });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.human(`tool#${step}:${call.name} error: ${errorMsg}`);
          await logger.json({
            type: "tool_error",
            step,
            tool: call.name,
            arguments: call.arguments,
            error: errorMsg,
          });
          messages.push({ role: "tool", content: `error: ${errorMsg}`, tool_call_id: call.id });
        }
      }
      continue;
    }

    if (response.content) {
      logger.human(`model#${step} -> ${response.content}`);
      return;
    }
  }

  console.warn("Reached max steps without final response");
}

function defaultSystemPrompt() {
  return [
    "You are GitHub Copilot running in a local CLI steward.",
    "Tools: read_file, grep_search, create_file, list_dir, execute, apply_patch, manage_todo, web_fetch, git_status, git_diff, workspace_summary.",
    "Stay within the current workspace; do not invent files or paths.",
    "Use tools to gather context before editing. Keep replies short and task-focused.",
    "When finished, provide a brief result and, if relevant, next steps.",
  ].join("\n");
}

function createLogger(options: {
  provider: string;
  model: string;
  logJsonPath?: string | null;
  enableHumanLogs?: boolean;
  enableFileLogs?: boolean;
}) {
  const logPath = options.enableFileLogs === false
    ? null
    : path.join(process.cwd(), options.logJsonPath ?? process.env.STEWARD_LOG_JSON ?? ".steward-log.jsonl");
  const human = options.enableHumanLogs === false ? (_msg: string) => {} : (msg: string) => console.log(msg);
  const json = async (entry: Record<string, unknown>) => {
    if (!logPath) return;
    const payload = {
      timestamp: new Date().toISOString(),
      provider: options.provider,
      model: options.model,
      ...entry,
    } as Record<string, unknown>;
    try {
      await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
    } catch (err) {
      console.error(`log write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return { human, json };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
}
