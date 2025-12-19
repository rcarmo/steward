import { applyPatch } from "diff";
import { spawn } from "bun";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import { minimatch } from "minimatch";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "./types.ts";

const TODO_FILE = ".steward-todo.json";

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const readFileTool: ToolHandler = async (args) => {
  const rawPath = args.path;
  if (typeof rawPath !== "string") {
    throw new Error("'path' must be a string");
  }

  const startLine = typeof args.startLine === "number" ? args.startLine : 1;
  const endLine = typeof args.endLine === "number" ? args.endLine : undefined;
  const maxLines = typeof args.maxLines === "number" ? args.maxLines : envInt("STEWARD_READ_MAX_LINES", 200);
  const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : envInt("STEWARD_READ_MAX_BYTES", 16_000);
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
  const maxResults = typeof args.maxResults === "number" ? args.maxResults : envInt("STEWARD_SEARCH_MAX_RESULTS", 80);
  const contextLines = typeof args.contextLines === "number" ? Math.max(0, args.contextLines) : 0;
  const beforeContext = typeof args.beforeContext === "number" ? Math.max(0, args.beforeContext) : contextLines;
  const afterContext = typeof args.afterContext === "number" ? Math.max(0, args.afterContext) : contextLines;
  const caseSensitive = args.caseSensitive === true;
  const smartCase = args.smartCase === true;
  const fixedString = args.fixedString === true;
  const wordMatch = args.wordMatch === true;
  const includeHidden = args.includeHidden === true;
  const includeBinary = args.includeBinary === true;
  const maxFileBytes = typeof args.maxFileBytes === "number" ? args.maxFileBytes : envInt("STEWARD_SEARCH_MAX_FILE_BYTES", 512_000);
  const withContextLabels = args.withContextLabels === true;
  const withContextSeparators = args.withContextSeparators === true;
  const withHeadings = args.withHeadings === true;
  const withCounts = args.withCounts === true;
  if (typeof pattern !== "string") {
    throw new Error("'pattern' must be a string");
  }
  await ensureInsideWorkspace(root);
  const matches: string[] = [];
  const perFile = new Map<string, { lines: string[]; matchCount: number; lastLineEmitted: number | null }>();
  const limitReached = () => matches.length >= maxResults;
  const matcher = buildMatcher({ pattern, isRegex, caseSensitive, smartCase, fixedString, wordMatch });
  await walk(root, async (filePath) => {
    if (limitReached()) return;
    const rel = relPath(filePath);
    if (includeGlob && !minimatch(rel, includeGlob, { dot: true })) return;
    if (excludeGlob && minimatch(rel, excludeGlob, { dot: true })) return;
    if (includePath && !includePath.test(filePath)) return;
    if (excludePath && excludePath.test(filePath)) return;
    if (!includeHidden && isHidden(rel)) return;
    const stat = await fs.stat(filePath);
    if (stat.size > maxFileBytes) return;
    const buf = await fs.readFile(filePath);
    if (!includeBinary && isBinaryBuffer(buf)) return;
    const content = buf.toString("utf8");
    const lines = content.split(/\r?\n/);
    let fileRecord = perFile.get(rel);
    if (!fileRecord) {
      fileRecord = { lines: [], matchCount: 0, lastLineEmitted: null };
      perFile.set(rel, fileRecord);
    }
    for (let idx = 0; idx < lines.length; idx++) {
      if (limitReached()) break;
      const line = lines[idx];
      if (matcher(line)) {
        fileRecord.matchCount += 1;
        const start = Math.max(0, idx - beforeContext);
        const end = Math.min(lines.length, idx + afterContext + 1);
        const needsSeparator = withContextSeparators && fileRecord.lastLineEmitted !== null && start > fileRecord.lastLineEmitted;
        if (needsSeparator) {
          const sep = "--";
          matches.push(sep);
          fileRecord.lines.push(sep);
        }
        for (let ctxIdx = start; ctxIdx < end; ctxIdx++) {
          if (fileRecord.lastLineEmitted !== null && ctxIdx <= fileRecord.lastLineEmitted) {
            continue;
          }
          const tag = withContextLabels ? (ctxIdx === idx ? "M" : "C") : undefined;
          const prefix = tag ? `${tag}: ` : "";
          const entry = `${relPath(filePath)}:${ctxIdx + 1}: ${prefix}${lines[ctxIdx].trim()}`;
          matches.push(entry);
          fileRecord.lines.push(entry);
        }
        fileRecord.lastLineEmitted = end - 1;
      }
    }
  }, limitReached);
  if (!matches.length) return { id: "search", output: "No matches" };
  if (withHeadings || withCounts) {
    const parts: string[] = [];
    for (const [file, record] of perFile) {
      if (!record.lines.length) continue;
      if (withHeadings) {
        const heading = withCounts ? `${file} (${record.matchCount} match${record.matchCount === 1 ? "" : "es"})` : file;
        parts.push(heading);
      }
      parts.push(...record.lines);
    }
    return { id: "search", output: parts.join("\n") };
  }
  return { id: "search", output: matches.join("\n") };
};

const executeTool: ToolHandler = async (args) => {
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
    const collect = async (stream: ReadableStream | null | undefined) => {
      if (!stream) return;
      const reader = stream.getReader();
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

const applyPatchTool: ToolHandler = async (args) => {
  const dryRun = args.dryRun === true;
  const hasBatch = Array.isArray(args.patches);
  if (hasBatch) {
    const patches = (args.patches as unknown[]).filter(
      (p): p is { path: string; patch: string } =>
        isPlainObject(p) && typeof (p as { path: unknown }).path === "string" && typeof (p as { patch: unknown }).patch === "string",
    );
    if (patches.length === 0) throw new Error("'patches' must be an array of {path, patch}");
    const results: { abs: string; content: string; next: string }[] = [];
    for (const entry of patches) {
      const abs = normalizePath(entry.path);
      await ensureInsideWorkspace(abs);
      const current = await fs.readFile(abs, "utf8");
      const next = applyPatch(current, entry.patch);
      if (next === false) {
        return { id: "edit", output: `Patch could not be applied to ${relPath(abs)}`, error: true };
      }
      results.push({ abs, content: current, next });
    }
    if (dryRun) {
      return { id: "edit", output: `Dry-run OK for ${results.length} file(s)` };
    }
    for (const r of results) {
      await fs.writeFile(r.abs, r.next, "utf8");
    }
    return { id: "edit", output: `Patched ${results.length} file(s)` };
  }

  const rawPath = args.path;
  const patch = args.patch;
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

const gitStatusTool: ToolHandler = async (args) => {
  const cwd = typeof args.path === "string" ? normalizePath(args.path) : process.cwd();
  await ensureInsideWorkspace(cwd);
  const { exitCode, stdout, stderr } = await runCaptured(["git", "status", "--short", "--branch"], cwd);
  const body = `exit ${exitCode}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`;
  return { id: "git_status", output: truncateOutput(body, envInt("STEWARD_GIT_MAX_OUTPUT_BYTES", 16_000)) };
};

const gitDiffTool: ToolHandler = async (args) => {
  const cwd = typeof args.path === "string" ? normalizePath(args.path) : process.cwd();
  const file = typeof args.file === "string" ? args.file : undefined;
  const ref = typeof args.ref === "string" ? args.ref : undefined;
  const staged = args.staged === true;
  await ensureInsideWorkspace(cwd);
  const cmd = ["git", "diff"];
  if (staged) cmd.push("--cached");
  if (ref) cmd.push(ref);
  if (file) cmd.push("--", file);
  const { exitCode, stdout, stderr } = await runCaptured(cmd, cwd);
  const body = `exit ${exitCode}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`;
  return { id: "git_diff", output: truncateOutput(body, envInt("STEWARD_GIT_MAX_OUTPUT_BYTES", 24_000)) };
};

const gitCommitTool: ToolHandler = async (args) => {
  const cwd = typeof args.path === "string" ? normalizePath(args.path) : process.cwd();
  const message = typeof args.message === "string" ? args.message : undefined;
  const all = args.all === true;
  if (!message) throw new Error("'message' is required");
  await ensureInsideWorkspace(cwd);
  const cmd = ["git", "commit"];
  if (all) cmd.push("--all");
  cmd.push("-m", message);
  const { exitCode, stdout, stderr } = await runCaptured(cmd, cwd);
  const body = `exit ${exitCode}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`;
  return { id: "git_commit", output: truncateOutput(body, envInt("STEWARD_GIT_MAX_OUTPUT_BYTES", 16_000)) };
};

const gitStashTool: ToolHandler = async (args) => {
  const cwd = typeof args.path === "string" ? normalizePath(args.path) : process.cwd();
  const action = typeof args.action === "string" ? args.action : "save";
  const message = typeof args.message === "string" ? args.message : undefined;
  await ensureInsideWorkspace(cwd);
  let cmd: string[];
  if (action === "save" || action === "push") {
    cmd = ["git", "stash", "push"];
    if (message) cmd.push("-m", message);
  } else if (action === "pop") {
    cmd = ["git", "stash", "pop"];
  } else if (action === "list") {
    cmd = ["git", "stash", "list"];
  } else {
    throw new Error("Unsupported stash action");
  }
  const { exitCode, stdout, stderr } = await runCaptured(cmd, cwd);
  const body = `exit ${exitCode}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`;
  return { id: "git_stash", output: truncateOutput(body, envInt("STEWARD_GIT_MAX_OUTPUT_BYTES", 16_000)) };
};

const workspaceSummaryTool: ToolHandler = async () => {
  const root = process.cwd();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    (e.isDirectory() ? dirs : files).push(e.name);
  }
  const pkgPath = path.join(root, "package.json");
  let pkgInfo = "";
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as { name?: string; version?: string; scripts?: Record<string, string> };
    pkgInfo = `package: ${pkg.name ?? "unknown"}@${pkg.version ?? ""}`;
  } catch {
    pkgInfo = "package: none";
  }
  const summary = [pkgInfo, `dirs: ${dirs.join(", ") || "-"}`, `files: ${files.join(", ") || "-"}`];
  return { id: "workspace_summary", output: summary.join("\n") };
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
  const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : envInt("STEWARD_WEB_MAX_BYTES", 24_000);
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
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_stash: gitStashTool,
  workspace_summary: workspaceSummaryTool,
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
        contextLines: { type: "number" },
        caseSensitive: { type: "boolean" },
        smartCase: { type: "boolean" },
        fixedString: { type: "boolean" },
        wordMatch: { type: "boolean" },
        includeHidden: { type: "boolean" },
        includeBinary: { type: "boolean" },
        maxFileBytes: { type: "number" },
        withContextLabels: { type: "boolean" },
        withContextSeparators: { type: "boolean" },
        beforeContext: { type: "number" },
        afterContext: { type: "number" },
        withHeadings: { type: "boolean" },
        withCounts: { type: "boolean" },
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
        background: { type: "boolean" },
        stream: { type: "boolean" },
        maxOutputBytes: { type: "number" },
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
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              patch: { type: "string" },
            },
            required: ["path", "patch"],
          },
        },
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
  {
    name: "git_status",
    description: "Show git status (short) for the workspace or subpath",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
    },
  },
  {
    name: "git_diff",
    description: "Show git diff (optionally staged or for a path/ref)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        file: { type: "string" },
        ref: { type: "string" },
        staged: { type: "boolean" },
      },
    },
  },
  {
    name: "git_commit",
    description: "Commit staged changes (optionally --all)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        message: { type: "string" },
        all: { type: "boolean" },
      },
      required: ["message"],
    },
  },
  {
    name: "git_stash",
    description: "Manage git stash (save/pop/list)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        action: { type: "string", enum: ["save", "push", "pop", "list"] },
        message: { type: "string" },
      },
    },
  },
  {
    name: "workspace_summary",
    description: "Basic workspace summary (package info, top-level dirs/files)",
    parameters: {
      type: "object",
      properties: {},
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
  const rootReal = await fs.realpath(root);
  let targetReal: string;
  try {
    targetReal = await fs.realpath(abs);
  } catch {
    // Walk up to the nearest existing ancestor to avoid symlink escapes for new files.
    const suffix: string[] = [];
    let current = abs;
    while (true) {
      const parent = path.dirname(current);
      suffix.unshift(path.basename(current));
      if (parent === current) {
        // Should never happen, but guard against infinite loops.
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

function truncateOutput(body: string, maxBytes: number) {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  if (data.length <= maxBytes) return body;
  const sliced = data.subarray(0, maxBytes);
  const decoder = new TextDecoder();
  return `${decoder.decode(sliced)}\n[truncated]`;
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildMatcher(opts: {
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

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isHidden(rel: string) {
  return rel.split(path.sep).some((part) => part.startsWith(".") && part !== ".");
}

function isBinaryBuffer(buf: Buffer) {
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0) return true;
  }
  return false;
}

async function runCaptured(cmd: string[], cwd: string) {
  const proc = spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout ? await proc.stdout.text() : "";
  const stderr = proc.stderr ? await proc.stderr.text() : "";
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function auditExecute(entry: {
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
    // Best-effort; ignore audit failures to avoid breaking tool calls.
  }
}
