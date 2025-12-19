import { applyPatch } from "diff";
import { promises as fs } from "node:fs";
import type { ToolDefinition } from "../types.ts";
import { ensureInsideWorkspace, isPlainObject, normalizePath, relPath } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const applyPatchDefinition: ToolDefinition = {
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
};

export const applyPatchTool: ToolHandler = async (args) => {
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
