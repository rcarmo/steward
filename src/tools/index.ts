import { applyPatchDefinition, applyPatchTool } from "./apply_patch.ts";
import { createFileDefinition, createFileTool } from "./create_file.ts";
import { executeDefinition, executeTool } from "./execute.ts";
import { gitCommitDefinition, gitCommitTool } from "./git_commit.ts";
import { gitDiffDefinition, gitDiffTool } from "./git_diff.ts";
import { gitStashDefinition, gitStashTool } from "./git_stash.ts";
import { gitStatusDefinition, gitStatusTool } from "./git_status.ts";
import { grepSearchDefinition, grepSearchTool } from "./grep_search.ts";
import { listDirDefinition, listDirTool } from "./list_dir.ts";
import { manageTodoDefinition, manageTodoTool } from "./manage_todo.ts";
import { readFileDefinition, readFileTool } from "./read_file.ts";
import { runJsDefinition, runJsTool } from "./run_js.ts";
import type { ToolHandler } from "./shared.ts";
import type { ToolDefinition } from "../types.ts";
import { webFetchDefinition, webFetchTool } from "./web_fetch.ts";
import { workspaceSummaryDefinition, workspaceSummaryTool } from "./workspace_summary.ts";

export { type ToolHandler } from "./shared.ts";

export const toolHandlers: Record<string, ToolHandler> = {
  read_file: readFileTool,
  grep_search: grepSearchTool,
  execute: executeTool,
  run_js: runJsTool,
  apply_patch: applyPatchTool,
  manage_todo: manageTodoTool,
  web_fetch: webFetchTool,
  create_file: createFileTool,
  list_dir: listDirTool,
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_stash: gitStashTool,
  workspace_summary: workspaceSummaryTool,
};

export const toolDefinitions: ToolDefinition[] = [
  readFileDefinition,
  grepSearchDefinition,
  createFileDefinition,
  listDirDefinition,
  executeDefinition,
  runJsDefinition,
  applyPatchDefinition,
  manageTodoDefinition,
  webFetchDefinition,
  gitStatusDefinition,
  gitDiffDefinition,
  gitCommitDefinition,
  gitStashDefinition,
  workspaceSummaryDefinition,
];
