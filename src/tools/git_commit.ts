import type { ToolDefinition } from "../types.ts";
import { envInt, ensureInsideWorkspace, normalizePath, truncateOutput } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";
import { runCaptured } from "./shared.ts";

export const gitCommitDefinition: ToolDefinition = {
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
};

export const gitCommitTool: ToolHandler = async (args) => {
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
