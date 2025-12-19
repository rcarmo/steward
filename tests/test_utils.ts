import { beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";

export function useSandbox() {
  const rootCwd = process.cwd();
  const originalEnv = { ...process.env };
  let sandbox = "";

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "steward-"));
    process.chdir(sandbox);
  });

  afterEach(async () => {
    process.chdir(rootCwd);
    await fs.rm(sandbox, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  return () => sandbox;
}

export async function initGitRepo(sandbox: string) {
  await toolHandlers.execute({ command: "git", args: ["init"], stream: true, cwd: sandbox, env: {} });
  await toolHandlers.execute({ command: "git", args: ["config", "user.email", "test@example.com"], stream: true, cwd: sandbox, env: {} });
  await toolHandlers.execute({ command: "git", args: ["config", "user.name", "Tester"], stream: true, cwd: sandbox, env: {} });
}
