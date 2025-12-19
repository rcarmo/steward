import type { ToolDefinition } from "../types.ts";
import { envInt, ensureInsideWorkspace, normalizePath, truncateOutput } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";
import { runCaptured } from "./shared.ts";

export const gitStashDefinition: ToolDefinition = {
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
};

export const gitStashTool: ToolHandler = async (args) => {
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
