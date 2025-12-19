import { spawn } from "bun";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.ts";

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
export type TodoStatus = "not-started" | "in-progress" | "blocked" | "done";

export async function walk(root: string, visit: (file: string) => Promise<void>, stop?: () => boolean) {
  if (stop?.()) return;
  const stats = await fs.stat(root);
  if (stats.isDirectory()) {
    const entries = await fs.readdir(root);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      if (stop?.()) break;
      const next = path.join(root, entry);
      await walk(next, visit, stop);
    }
  } else if (stats.isFile()) {
    await visit(root);
  }
}

export async function readTodo(file: string) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as { nextId: number; items: { id: number; title: string; status: TodoStatus }[] };
  } catch {
    return { nextId: 1, items: [] as { id: number; title: string; status: TodoStatus }[] };
  }
}

export async function writeTodo(file: string, data: { nextId: number; items: { id: number; title: string; status: TodoStatus }[] }) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

export function normalizePath(p: string) {
  const abs = path.resolve(process.cwd(), p);
  return abs;
}

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function objectToStringMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export async function ensureInsideWorkspace(abs: string, mustExist: boolean = true) {
  const root = process.cwd();
  const rootReal = await fs.realpath(root);
  let targetReal: string;
  try {
    targetReal = await fs.realpath(abs);
  } catch {
    const suffix: string[] = [];
    let current = abs;
    while (true) {
      const parent = path.dirname(current);
      suffix.unshift(path.basename(current));
      if (parent === current) {
        throw new Error("Path outside workspace");
      }
      try {
        const ancestorReal = await fs.realpath(parent);
        targetReal = path.join(ancestorReal, ...suffix);
        break;
      } catch {
        current = parent;
        continue;
      }
    }
  }
  const rel = path.relative(rootReal, targetReal);
  if (rel.startsWith("..")) {
    throw new Error("Path outside workspace");
  }
  if (mustExist) {
    const exists = await fs.access(abs).then(() => true).catch(() => false);
    if (!exists) throw new Error("Path does not exist");
  }
}

export function relPath(abs: string) {
  return path.relative(process.cwd(), abs) || path.basename(abs);
}

export function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function inferContentType(url: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(url);
  return match?.[1];
}

export function isTodoStatus(val: string): val is TodoStatus {
  return val === "not-started" || val === "in-progress" || val === "blocked" || val === "done";
}

export function truncateOutput(body: string, maxBytes: number) {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  if (data.length <= maxBytes) return body;
  const sliced = data.subarray(0, maxBytes);
  const decoder = new TextDecoder();
  return `${decoder.decode(sliced)}\n[truncated]`;
}

export function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildMatcher(opts: {
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  smartCase: boolean;
  fixedString: boolean;
  wordMatch: boolean;
}) {
  const { pattern, isRegex, smartCase, fixedString, wordMatch } = opts;
  let { caseSensitive } = opts;
  if (!caseSensitive && smartCase && /[A-Z]/.test(pattern)) {
    caseSensitive = true;
  }
  const flags = caseSensitive ? "" : "i";
  if (isRegex) {
    const re = new RegExp(pattern, flags);
    return (line: string) => re.test(line);
  }
  const escaped = fixedString || wordMatch ? escapeRegex(pattern) : pattern;
  const source = wordMatch ? `\\b${escaped}\\b` : escaped;
  const re = new RegExp(source, flags);
  return (line: string) => re.test(line);
}

export function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

export function isHidden(rel: string) {
  return rel.split(path.sep).some((part) => part.startsWith(".") && part !== ".");
}

export function isBinaryBuffer(buf: Buffer) {
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0) return true;
  }
  return false;
}

export async function runCaptured(cmd: string[], cwd: string) {
  const proc = spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout ? await proc.stdout.text() : "";
  const stderr = proc.stderr ? await proc.stderr.text() : "";
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

export async function auditExecute(entry: {
  command: string;
  argList: string[];
  cwd: string;
  exitCode: number | null;
  error?: string;
  truncated?: boolean;
  mode: "background" | "stream" | "default" | "error";
}) {
  try {
    const logPath = path.join(process.cwd(), ".steward-exec-audit.log");
    const record = {
      ts: new Date().toISOString(),
      cmd: entry.command,
      args: entry.argList,
      cwd: relPath(entry.cwd),
      exitCode: entry.exitCode,
      mode: entry.mode,
      truncated: entry.truncated === true,
      error: entry.error,
    };
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // best-effort
  }
}
