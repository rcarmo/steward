import type { ToolDefinition } from "../types.ts";
import { envInt, ensureInsideWorkspace, normalizePath, truncateOutput } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";
import { runCaptured } from "./shared.ts";

export const gitStatusDefinition: ToolDefinition = {
  name: "git_status",
  description: "Show git status (short) for the workspace or subpath",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
  },
};

export const gitStatusTool: ToolHandler = async (args) => {
  const cwd = typeof args.path === "string" ? normalizePath(args.path) : process.cwd();
  await ensureInsideWorkspace(cwd);
  const { exitCode, stdout, stderr } = await runCaptured(["git", "status", "--short", "--branch"], cwd);
  const body = `exit ${exitCode}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`;
  return { id: "git_status", output: truncateOutput(body, envInt("STEWARD_GIT_MAX_OUTPUT_BYTES", 16_000)) };
};
