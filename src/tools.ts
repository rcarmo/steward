import { applyPatch } from "diff";
import { spawn } from "bun";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import { minimatch } from "minimatch";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "./types.ts";

const TODO_FILE = ".harness-todo.json";

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const readFileTool: ToolHandler = async (args) => {
  const rawPath = args.path;
  if (typeof rawPath !== "string") {
    throw new Error("'path' must be a string");
  }

  const startLine = typeof args.startLine === "number" ? args.startLine : 1;
  const endLine = typeof args.endLine === "number" ? args.endLine : undefined;
  const maxLines = typeof args.maxLines === "number" ? args.maxLines : 200;
  const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : 16_000;
  const abs = normalizePath(rawPath);
  await ensureInsideWorkspace(abs);
  const contents = await fs.readFile(abs, "utf8");
  const limited = contents.slice(0, maxBytes);
  const lines = limited.split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine ?? startLine - 1 + maxLines);
  const segment = slice.join("\n");
  const from = startLine;
  const to = endLine ?? startLine - 1 + slice.length;
  const truncatedBytes = contents.length > limited.length;
  const truncatedLines = endLine === undefined && slice.length >= maxLines;
  const note = truncatedBytes || truncatedLines ? "\n[truncated]" : "";
  return { id: "read", output: `Lines ${from}-${to}:\n${segment}${note}` };
};

const grepSearchTool: ToolHandler = async (args) => {
  const pattern = args.pattern;
  const root = normalizePath(typeof args.path === "string" ? args.path : ".");
  const isRegex = args.regex === true;
  const includePath = typeof args.includePath === "string" ? new RegExp(args.includePath, "i") : undefined;
  const excludePath = typeof args.excludePath === "string" ? new RegExp(args.excludePath, "i") : undefined;
  const includeGlob = typeof args.includeGlob === "string" ? args.includeGlob : undefined;
  const excludeGlob = typeof args.excludeGlob === "string" ? args.excludeGlob : undefined;
  const maxResults = typeof args.maxResults === "number" ? args.maxResults : 80;
  if (typeof pattern !== "string") {
    throw new Error("'pattern' must be a string");
  }
  await ensureInsideWorkspace(root);
  const matches: string[] = [];
  const limitReached = () => matches.length >= maxResults;
  const re = isRegex ? new RegExp(pattern, "i") : undefined;
  await walk(root, async (filePath) => {
    if (limitReached()) return;
    const rel = relPath(filePath);
    if (includeGlob && !minimatch(rel, includeGlob, { dot: true })) return;
    if (excludeGlob && minimatch(rel, excludeGlob, { dot: true })) return;
    if (includePath && !includePath.test(filePath)) return;
    if (excludePath && excludePath.test(filePath)) return;
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      if (limitReached()) break;
      const line = lines[idx];
      if (isRegex) {
        if (re && re.test(line)) {
          matches.push(`${relPath(filePath)}:${idx + 1}: ${line.trim()}`);
        }
      } else if (line.toLowerCase().includes(pattern.toLowerCase())) {
        matches.push(`${relPath(filePath)}:${idx + 1}: ${line.trim()}`);
      }
    }
  }, limitReached);
  return { id: "search", output: matches.length ? matches.join("\n") : "No matches" };
};

const executeTool: ToolHandler = async (args) => {
  const command = args.command;
  const argList = Array.isArray(args.args) ? args.args.filter((x) => typeof x === "string") as string[] : [];
  const cwd = typeof args.cwd === "string" ? normalizePath(args.cwd) : process.cwd();
  const env = isPlainObject(args.env) ? objectToStringMap(args.env as Record<string, unknown>) : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
  if (process.env.HARNESS_ALLOW_EXECUTE !== "1") {
    throw new Error("execute tool disabled; set HARNESS_ALLOW_EXECUTE=1 to enable");
  }
  if (typeof command !== "string") {
    throw new Error("'command' must be a string");
  }
  await ensureInsideWorkspace(cwd);
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : undefined;
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
    return { id: "execute", output: `exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "execute", output: `error: ${msg}`, error: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const applyPatchTool: ToolHandler = async (args) => {
  const rawPath = args.path;
  const patch = args.patch;
  const dryRun = args.dryRun === true;
  if (typeof rawPath !== "string" || typeof patch !== "string") {
    throw new Error("'path' and 'patch' must be strings");
  }
  const abs = normalizePath(rawPath);
  await ensureInsideWorkspace(abs);
  const current = await fs.readFile(abs, "utf8");
  const next = applyPatch(current, patch);
  if (next === false) {
    return { id: "edit", output: "Patch could not be applied", error: true };
  }
  if (dryRun) {
    return { id: "edit", output: `Dry-run OK for ${relPath(abs)}` };
  }
  await fs.writeFile(abs, next, "utf8");
  return { id: "edit", output: `Patched ${relPath(abs)}` };
};

const manageTodoTool: ToolHandler = async (args) => {
  const action = args.action;
  const title = typeof args.title === "string" ? args.title.trim() : undefined;
  const file = path.join(process.cwd(), TODO_FILE);
  const todo = await readTodo(file);

  if (action === "list") {
    const body = todo.items
      .map((item) => `${item.id}. [${item.status}] ${item.title}`)
      .join("\n");
    return { id: "todo", output: body || "No todos" };
  }
  if (action === "add") {
    if (!title) throw new Error("'title' required for add");
    const next = { id: todo.nextId++, title, status: "not-started" as TodoStatus };
    todo.items.push(next);
    await writeTodo(file, todo);
    return { id: "todo", output: `Added ${next.id}. ${next.title}` };
  }
  if (action === "done") {
    const id = typeof args.id === "number" ? args.id : undefined;
    if (id === undefined) throw new Error("'id' required for done");
    const item = todo.items.find((t) => t.id === id);
    if (!item) throw new Error(`Todo ${id} not found`);
    item.status = "done";
    await writeTodo(file, todo);
    return { id: "todo", output: `Completed ${id}. ${item.title}` };
  }
  if (action === "set_status") {
    const id = typeof args.id === "number" ? args.id : undefined;
    const status = typeof args.status === "string" ? args.status : undefined;
    if (id === undefined || !status) throw new Error("'id' and 'status' required for set_status");
    if (!isTodoStatus(status)) throw new Error("Invalid status");
    const item = todo.items.find((t) => t.id === id);
    if (!item) throw new Error(`Todo ${id} not found`);
    item.status = status;
    await writeTodo(file, todo);
    return { id: "todo", output: `Set ${id} to ${status}` };
  }
  throw new Error("Unsupported todo action");
};

const webFetchTool: ToolHandler = async (args) => {
  const url = args.url;
  const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : 24_000;
  const textOnly = args.textOnly === true;
  if (typeof url !== "string") throw new Error("'url' must be a string");
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const limited = buf.subarray(0, maxBytes);
  const text = limited.toString("utf8");
  const output = textOnly ? stripHtml(text) : text;
  const headerCtype = res.headers.get("content-type") ?? "";
  const inferred = inferContentType(url) ?? headerCtype;
  return { id: "web", output: `content-type: ${inferred}\n${output}` };
};

const createFileTool: ToolHandler = async (args) => {
  const rawPath = args.path;
  const content = typeof args.content === "string" ? args.content : "";
  const overwrite = args.overwrite === true;
  if (typeof rawPath !== "string") throw new Error("'path' must be a string");
  const abs = normalizePath(rawPath);
  await ensureInsideWorkspace(abs, false);
  const exists = await fs.access(abs).then(() => true).catch(() => false);
  if (exists && !overwrite) throw new Error("File exists; set overwrite true to replace");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { id: "create_file", output: `Created ${relPath(abs)}` };
};

const listDirTool: ToolHandler = async (args) => {
  const rawPath = typeof args.path === "string" ? args.path : ".";
  const includeIgnored = args.includeIgnored === true;
  const abs = normalizePath(rawPath);
  await ensureInsideWorkspace(abs);
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) throw new Error("Path is not a directory");
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const filtered = entries.filter((e) => {
    if (!includeIgnored && (e.name === "node_modules" || e.name === ".git")) return false;
    return true;
  });
  const lines = filtered.map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`);
  return { id: "list_dir", output: lines.join("\n") };
};

export const toolHandlers: Record<string, ToolHandler> = {
  read_file: readFileTool,
  grep_search: grepSearchTool,
  execute: executeTool,
  apply_patch: applyPatchTool,
  manage_todo: manageTodoTool,
  web_fetch: webFetchTool,
  create_file: createFileTool,
  list_dir: listDirTool,
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read file content with optional line range",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
        maxLines: { type: "number" },
        maxBytes: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "grep_search",
    description: "Search for a pattern in workspace files",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        regex: { type: "boolean" },
        includePath: { type: "string" },
        excludePath: { type: "string" },
        includeGlob: { type: "string" },
        excludeGlob: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "create_file",
    description: "Create or overwrite a file with content",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        overwrite: { type: "boolean" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List directory entries (files and subdirectories)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        includeIgnored: { type: "boolean" },
      },
    },
  },
  {
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
      },
      required: ["command"],
    },
  },
  {
    name: "apply_patch",
    description: "Apply a unified diff patch to a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        patch: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["path", "patch"],
    },
  },
  {
    name: "manage_todo",
    description: "Manage a simple todo list",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "done", "set_status"] },
        title: { type: "string" },
        id: { type: "number" },
        status: { type: "string", enum: ["not-started", "in-progress", "blocked", "done"] },
      },
      required: ["action"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch content from a URL (truncated, optional text-only)",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        maxBytes: { type: "number" },
        textOnly: { type: "boolean" },
      },
      required: ["url"],
    },
  },
];

async function walk(root: string, visit: (file: string) => Promise<void>, stop?: () => boolean) {
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

async function readTodo(file: string) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as { nextId: number; items: { id: number; title: string; status: TodoStatus }[] };
  } catch {
    return { nextId: 1, items: [] as { id: number; title: string; status: TodoStatus }[] };
  }
}

async function writeTodo(file: string, data: { nextId: number; items: { id: number; title: string; status: TodoStatus }[] }) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function normalizePath(p: string) {
  const abs = path.resolve(process.cwd(), p);
  return abs;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function objectToStringMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function ensureInsideWorkspace(abs: string, mustExist: boolean = true) {
  const root = process.cwd();
  const rel = path.relative(root, abs);
  if (rel.startsWith("..")) {
    throw new Error("Path outside workspace");
  }
  if (mustExist) {
    const exists = await fs.access(abs).then(() => true).catch(() => false);
    if (!exists) throw new Error("Path does not exist");
  }
}

function relPath(abs: string) {
  return path.relative(process.cwd(), abs) || path.basename(abs);
}

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function inferContentType(url: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(url);
  return match?.[1];
}

type TodoStatus = "not-started" | "in-progress" | "blocked" | "done";

function isTodoStatus(val: string): val is TodoStatus {
  return val === "not-started" || val === "in-progress" || val === "blocked" || val === "done";
}
