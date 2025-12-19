import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../types.ts";
import { ensureInsideWorkspace, normalizePath, relPath } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const createFileDefinition: ToolDefinition = {
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
};

export const createFileTool: ToolHandler = async (args) => {
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
