import { spawn } from "bun";
import type { ToolDefinition } from "../types.ts";
import { auditExecute, envInt, ensureInsideWorkspace, isPlainObject, normalizePath, objectToStringMap, truncateOutput } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const executeDefinition: ToolDefinition = {
  name: "execute",
  description: "Run a shell command with optional args",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string" },
      env: { type: "object" },
      timeoutMs: { type: "number" },
      background: { type: "boolean" },
      stream: { type: "boolean" },
      maxOutputBytes: { type: "number" },
    },
    required: ["command"],
  },
};

export const executeTool: ToolHandler = async (args) => {
  const command = args.command;
  const argList = Array.isArray(args.args) ? args.args.filter((x) => typeof x === "string") as string[] : [];
  const cwd = typeof args.cwd === "string" ? normalizePath(args.cwd) : process.cwd();
  const env = isPlainObject(args.env) ? objectToStringMap(args.env as Record<string, unknown>) : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
  const background = args.background === true;
  const stream = args.stream === true;
  const maxOutputBytes = typeof args.maxOutputBytes === "number" ? args.maxOutputBytes : envInt("STEWARD_EXEC_MAX_OUTPUT_BYTES", 32_000);
  const envAllow = (process.env.STEWARD_EXEC_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const envDeny = (process.env.STEWARD_EXEC_DENY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const envTimeoutMs = Number.parseInt(process.env.STEWARD_EXEC_TIMEOUT_MS ?? "");
  const effectiveTimeout = timeoutMs ?? (Number.isFinite(envTimeoutMs) ? envTimeoutMs : undefined);
  const auditEnabled = process.env.STEWARD_EXEC_AUDIT !== "0";
  if (process.env.STEWARD_ALLOW_EXECUTE !== "1") {
    throw new Error("execute tool disabled; set STEWARD_ALLOW_EXECUTE=1 to enable");
  }
  if (typeof command !== "string") {
    throw new Error("'command' must be a string");
  }
  if (envAllow.length > 0 && !envAllow.includes(command)) {
    throw new Error("command not allowed by STEWARD_EXEC_ALLOW");
  }
  if (envDeny.length > 0 && envDeny.includes(command)) {
    throw new Error("command blocked by STEWARD_EXEC_DENY");
  }
  await ensureInsideWorkspace(cwd);
  if (background) {
    const proc = spawn({
      cmd: [command, ...argList],
      stdout: "ignore",
      stderr: "ignore",
      cwd,
      env,
    });
    if (auditEnabled) await auditExecute({ command, argList, cwd, exitCode: null, mode: "background" });
    return { id: "execute", output: `started pid ${proc.pid}` };
  }
  if (stream) {
    const proc = spawn({ cmd: [command, ...argList], cwd, env, stdout: "pipe", stderr: "pipe" });
    const chunks: string[] = [];
    const collect = async (streamObj: ReadableStream | null | undefined) => {
      if (!streamObj) return;
      const reader = streamObj.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(typeof value === "string" ? value : new TextDecoder().decode(value));
      }
    };
    const exitCode = await proc.exited;
    await Promise.all([collect(proc.stdout), collect(proc.stderr)]);
    const combined = chunks.join("");
    const truncated = truncateOutput(combined, maxOutputBytes);
    if (auditEnabled) await auditExecute({ command, argList, cwd, exitCode, truncated: truncated.endsWith("[truncated]"), mode: "stream" });
    return { id: "execute", output: truncated };
  }
  const controller = effectiveTimeout ? new AbortController() : undefined;
  const timer = effectiveTimeout ? setTimeout(() => controller?.abort(), effectiveTimeout) : undefined;
  try {
    const proc = spawn({
      cmd: [command, ...argList],
      stdout: "pipe",
      stderr: "pipe",
      cwd,
      env,
      signal: controller?.signal,
    });
    const stdout = proc.stdout ? await proc.stdout.text() : "";
    const stderr = proc.stderr ? await proc.stderr.text() : "";
    const exitCode = await proc.exited;
    const body = `exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    const truncated = truncateOutput(body, maxOutputBytes);
    if (auditEnabled) await auditExecute({ command, argList, cwd, exitCode, truncated: truncated.endsWith("[truncated]"), mode: "default" });
    return { id: "execute", output: truncated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (auditEnabled) await auditExecute({ command, argList, cwd, exitCode: null, error: msg, mode: "error" });
    return { id: "execute", output: `error: ${msg}`, error: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
};
