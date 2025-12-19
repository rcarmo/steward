import { promises as fs } from "node:fs";
import path from "node:path";
import boxen from "boxen";
import chalk from "chalk";
import cliTruncate from "cli-truncate";
import { buildClient } from "./llm.ts";
import { toolDefinitions, toolHandlers } from "./tools.ts";
import type { Message } from "./types.ts";

export type RunnerOptions = {
  prompt: string;
  systemPrompt?: string;
  maxSteps?: number;
  requestTimeoutMs?: number;
  retries?: number;
  provider?: string;
  model?: string;
  logJsonPath?: string | null;
  enableHumanLogs?: boolean;
  enableFileLogs?: boolean;
  prettyLogs?: boolean;
};

export async function runSteward(options: RunnerOptions) {
  const client = buildClient(options.provider ?? "echo", options.model ?? "gpt-4o-mini");
  const logger = createLogger({
    provider: options.provider ?? "echo",
    model: options.model ?? "gpt-4o-mini",
    logJsonPath: options.logJsonPath,
    enableHumanLogs: options.enableHumanLogs !== false,
    enableFileLogs: options.enableFileLogs !== false,
    pretty: options.prettyLogs === true,
  });
  const messages: Message[] = [];

  const system = options.systemPrompt ?? defaultSystemPrompt();
  messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: options.prompt });

  const limit = options.maxSteps ?? 16;
  const retryLimit = options.retries ?? 0;
  const requestTimeoutMs = options.requestTimeoutMs;
  for (let step = 0; step < limit; step++) {
    let response;
    try {
      response = await callModelWithPolicies({
        client,
        messages,
        retryLimit,
        requestTimeoutMs,
        step,
        logger,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.human({ title: "model", body: `step ${step} failed: ${message}`, variant: "error" });
      await logger.json({ type: "model_error", step, error: message, fatal: true });
      return;
    }
    await logger.json({
      type: "model_response",
      step,
      provider: options.provider ?? "echo",
      model: options.model ?? "gpt-4o-mini",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    if (response.toolCalls?.length) {
      const thought = response.content ?? formatToolCalls(response.toolCalls);
      logger.human({ title: "model", body: thought });
      logger.human({ title: "model", body: `step ${step} → tool calls: ${response.toolCalls.map((c) => c.name).join(", ")}` });
      messages.push({ role: "assistant", content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        const todoVariant = call.name === "manage_todo" ? "todo" : undefined;
        const handler = toolHandlers[call.name];
        if (!handler) {
          messages.push({ role: "tool", content: `Unknown tool ${call.name}`, tool_call_id: call.id });
          continue;
        }
        logger.human({ title: call.name, body: `args=${safeJson(call.arguments)}`, variant: todoVariant });
        try {
          const result = await handler(call.arguments);
          logger.human({ title: call.name, body: result.output, variant: todoVariant });
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
          logger.human({ title: call.name, body: `error: ${errorMsg}`, variant: "error" });
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
      logger.human({ title: "model", body: response.content });
      return;
    }
  }

  console.warn("Reached max steps without final response");
}

async function callModelWithPolicies(args: {
  client: ReturnType<typeof buildClient>;
  messages: Message[];
  retryLimit: number;
  requestTimeoutMs?: number;
  step: number;
  logger: ReturnType<typeof createLogger>;
}) {
  const stopSpinner = args.logger.startSpinner();
  try {
    let lastError: unknown;
    const attempts = Math.max(0, args.retryLimit) + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await withTimeout(() => args.client.generate(args.messages, toolDefinitions), args.requestTimeoutMs);
        if (attempt > 1) {
          args.logger.human({ title: "model", body: `step ${args.step} retry ${attempt} succeeded` });
          await args.logger.json({ type: "model_retry_success", step: args.step, attempt });
        }
        return result;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const isLast = attempt === attempts;
        args.logger.human({ title: "model", body: `step ${args.step} attempt ${attempt} failed: ${message}`, variant: isLast ? "error" : "warn" });
        await args.logger.json({ type: "model_retry", step: args.step, attempt, error: message, terminal: isLast });
        if (isLast) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Unknown model error"));
  } finally {
    stopSpinner();
  }
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function defaultSystemPrompt() {
  const toolList = toolDefinitions.map((t) => t.name).join(", ");
  return [
    "You are GitHub Copilot running in a local CLI environment.",
    `Tools: ${toolList}.`,
    "Stay within the current workspace; do not invent files or paths.",
    "Briefly state your intent before calling tools; narrate what you are doing and why.",
    "When multiple actions are needed, plan them as todos via manage_todo, then execute and update their status; show the final todo state when done.",
    "Use tools to gather context before editing. Keep replies short and task-focused.",
    "After tools finish, give a concise result and, if helpful, next steps.",
  ].join("\n");
}

function createLogger(options: {
  provider: string;
  model: string;
  logJsonPath?: string | null;
  enableHumanLogs?: boolean;
  enableFileLogs?: boolean;
  pretty?: boolean;
}) {
  const logPath = options.enableFileLogs === false
    ? null
    : path.join(process.cwd(), options.logJsonPath ?? process.env.STEWARD_LOG_JSON ?? ".steward-log.jsonl");
  const colorForVariant = (variant: HumanEntry["variant"]) => {
    if (variant === "error") return chalk.red;
    if (variant === "warn") return chalk.yellow;
    if (variant === "todo") return chalk.magenta;
    return chalk.cyan;
  };
  const prefixForVariant = (variant: HumanEntry["variant"]) => {
    if (variant === "error") return "[error]";
    if (variant === "warn") return "[warn]";
    if (variant === "todo") return "[todo]";
    return "[info]";
  };

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let spinnerFrame = 0;
  const stopSpinner = () => {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = undefined;
    spinnerFrame = 0;
    process.stdout.write("\r \r\n");
  };
  const startSpinner = () => {
    if (options.enableHumanLogs === false || options.pretty !== true) return () => {};
    if (spinnerTimer) return stopSpinner;
    spinnerTimer = setInterval(() => {
      const frame = spinnerFrames[spinnerFrame % spinnerFrames.length];
      spinnerFrame++;
      const line = chalk.gray(`waiting ${frame}`);
      process.stdout.write(`\r${line}`);
    }, 120);
    return stopSpinner;
  };
  const human = options.enableHumanLogs === false
    ? (_entry: HumanEntry) => {}
    : options.pretty
      ? (entry: HumanEntry) => {
          const width = Math.max(40, Math.min(process.stdout.columns ?? 80, 120));
          const title = entry.title ?? "steward";
          const color = colorForVariant(entry.variant);
          const body = cliTruncate(entry.body ?? "", width - 4);
          const box = boxen(color.bold(title) + "\n" + body, {
            padding: 1,
            margin: 0,
            borderStyle: "round",
            borderColor: entry.variant === "error" ? "red" : entry.variant === "warn" ? "yellow" : entry.variant === "todo" ? "magenta" : "cyan",
            align: "left",
            title: undefined,
          });
          console.log(box);
        }
      : (entry: HumanEntry) => {
          const prefix = prefixForVariant(entry.variant);
          const title = entry.title ? `${entry.title}: ` : "";
          console.log(`${prefix} ${title}${entry.body ?? ""}`);
        };
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
  return { human, json, startSpinner, stopSpinner };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
}

function formatToolCalls(calls: { name: string; arguments: Record<string, unknown> }[]): string {
  const parts = calls.map((c) => `${c.name} args=${safeJson(c.arguments)}`);
  const combined = parts.join("; ");
  const max = 320;
  return combined.length > max ? `${combined.slice(0, max)}…` : combined;
}

type HumanEntry = {
  title?: string;
  body?: string;
  variant?: "info" | "warn" | "error" | "todo";
};
