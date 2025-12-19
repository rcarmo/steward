import { promises as fs } from "node:fs";
import { minimatch } from "minimatch";
import type { ToolDefinition } from "../types.ts";
import { buildMatcher, envInt, ensureInsideWorkspace, isBinaryBuffer, isHidden, normalizePath, relPath, walk } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const grepSearchDefinition: ToolDefinition = {
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
};

export const grepSearchTool: ToolHandler = async (args) => {
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
