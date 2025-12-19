import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../types.ts";
import type { ToolHandler } from "./shared.ts";

export const workspaceSummaryDefinition: ToolDefinition = {
  name: "workspace_summary",
  description: "Basic workspace summary (package info, top-level dirs/files)",
  parameters: {
    type: "object",
    properties: {},
  },
};

export const workspaceSummaryTool: ToolHandler = async () => {
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
