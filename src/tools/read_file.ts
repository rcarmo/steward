import { promises as fs } from "node:fs";
import type { ToolDefinition } from "../types.ts";
import { envInt, ensureInsideWorkspace, normalizePath } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const readFileDefinition: ToolDefinition = {
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
};

export const readFileTool: ToolHandler = async (args) => {
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
