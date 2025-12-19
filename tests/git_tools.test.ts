import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { initGitRepo, useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("git tools", () => {
  it("git_status and git_diff work", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const sandbox = getSandbox();
    await initGitRepo(sandbox);
    await fs.writeFile(path.join(sandbox, "g.txt"), "one\n", "utf8");
    await toolHandlers.execute({ command: "git", args: ["add", "g.txt"], stream: true, cwd: sandbox, env: {} });
    const status = await toolHandlers.git_status({ path: sandbox });
    expect(status.output).toContain("##");
    await fs.writeFile(path.join(sandbox, "g.txt"), "two\n", "utf8");
    const diff = await toolHandlers.git_diff({ path: sandbox, file: "g.txt" });
    expect(diff.output).toContain("-one");
    expect(diff.output).toContain("+two");
  });

  it("git_commit commits staged changes", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_AUDIT = "0";
    const sandbox = getSandbox();
    await initGitRepo(sandbox);
    await fs.writeFile(path.join(sandbox, "c.txt"), "one\n", "utf8");
    await toolHandlers.execute({ command: "git", args: ["add", "c.txt"], stream: true, cwd: sandbox, env: {} });
    const commit = await toolHandlers.git_commit({ path: sandbox, message: "init commit" });
    expect(commit.output).toContain("exit 0");
    const status = await toolHandlers.git_status({ path: sandbox });
    expect(status.output).toContain("exit 0");
    expect(status.output).not.toMatch(/\n\?\?/);
    expect(status.output).not.toMatch(/\n [MAD]/);
  });

  it("git_stash saves and restores changes", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const sandbox = getSandbox();
    await initGitRepo(sandbox);
    const file = path.join(sandbox, "s.txt");
    await fs.writeFile(file, "base\n", "utf8");
    await toolHandlers.execute({ command: "git", args: ["add", "s.txt"], stream: true, cwd: sandbox, env: {} });
    await toolHandlers.git_commit({ path: sandbox, message: "base" });

    await fs.writeFile(file, "changed\n", "utf8");
    const stashSave = await toolHandlers.git_stash({ path: sandbox, action: "save", message: "wip" });
    expect(stashSave.output).toContain("exit 0");
    const afterSave = await fs.readFile(file, "utf8");
    expect(afterSave.trim()).toBe("base");

    const stashPop = await toolHandlers.git_stash({ path: sandbox, action: "pop" });
    expect(stashPop.output).toContain("exit 0");
    const afterPop = await fs.readFile(file, "utf8");
    expect(afterPop.trim()).toBe("changed");
  });
});
