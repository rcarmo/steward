import type { ToolDefinition } from "../types.ts";
import { envInt, ensureInsideWorkspace, normalizePath, truncateOutput } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";
import { runCaptured } from "./shared.ts";

export const gitDiffDefinition: ToolDefinition = {
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
};

export const gitDiffTool: ToolHandler = async (args) => {
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
