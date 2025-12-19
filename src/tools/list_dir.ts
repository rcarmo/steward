import { promises as fs } from "node:fs";
import type { ToolDefinition } from "../types.ts";
import { ensureInsideWorkspace, normalizePath } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const listDirDefinition: ToolDefinition = {
  name: "list_dir",
  description: "List directory entries (files and subdirectories)",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      includeIgnored: { type: "boolean" },
    },
  },
};

export const listDirTool: ToolHandler = async (args) => {
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
