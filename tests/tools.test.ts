import { beforeEach, afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHandlers } from "../src/tools.ts";

const rootCwd = process.cwd();
let sandbox: string;
const originalEnv = { ...process.env };

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "harness-"));
  process.chdir(sandbox);
});

afterEach(async () => {
  process.chdir(rootCwd);
  await fs.rm(sandbox, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("toolHandlers", () => {
  it("read_file reads file content within range", async () => {
    await fs.writeFile(path.join(sandbox, "sample.txt"), "one\ntwo\nthree\n", "utf8");
    const result = await toolHandlers.read_file({ path: "sample.txt", startLine: 1, endLine: 2 });
    expect(result.output).toContain("Lines 1-2:");
    expect(result.output).toContain("one\ntwo");
  });

  it("read_file truncates by lines and bytes", async () => {
    const big = "x".repeat(20_000);
    await fs.writeFile(path.join(sandbox, "big.txt"), big, "utf8");
    const result = await toolHandlers.read_file({ path: "big.txt", maxBytes: 100, maxLines: 1 });
    expect(result.output).toContain("Lines 1-1:");
    expect(result.output).toContain("[truncated]");
  });

  it("grep_search finds matches", async () => {
    await fs.writeFile(path.join(sandbox, "search.txt"), "hello world\nbye\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hello" });
    expect(result.output).toContain("search.txt:1: hello world");
  });

  it("grep_search respects include/exclude filters and maxResults", async () => {
    await fs.mkdir(path.join(sandbox, "skip"));
    await fs.mkdir(path.join(sandbox, "keep"));
    await fs.writeFile(path.join(sandbox, "skip/hit.txt"), "hello\n", "utf8");
    await fs.writeFile(path.join(sandbox, "keep/hit.txt"), "hello\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hello", excludePath: "skip" });
    expect(result.output).toContain("keep/hit.txt:1: hello");
    expect(result.output).not.toContain("skip/hit.txt");
    const globResult = await toolHandlers.grep_search({ pattern: "hello", includeGlob: "keep/**" });
    expect(globResult.output).toContain("keep/hit.txt:1: hello");
    expect(globResult.output).not.toContain("skip/hit.txt");
  });

  it("execute runs a command", async () => {
    process.env.HARNESS_ALLOW_EXECUTE = "1";
    const result = await toolHandlers.execute({ command: "pwd" });
    expect(result.output).toContain("exit 0");
    expect(result.output).toContain(sandbox);
  });

  it("execute is gated by HARNESS_ALLOW_EXECUTE", async () => {
    delete process.env.HARNESS_ALLOW_EXECUTE;
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
  });

  it("execute honors cwd, env, and timeout", async () => {
    process.env.HARNESS_ALLOW_EXECUTE = "1";
    const subdir = path.join(sandbox, "sub");
    await fs.mkdir(subdir);
    const result = await toolHandlers.execute({ command: "pwd", cwd: "sub", env: { FOO: "BAR" } });
    expect(result.output).toContain("sub");
    const timeoutResult = await toolHandlers.execute({ command: "sleep", args: ["2"], timeoutMs: 100 });
    expect(timeoutResult.output).toMatch(/exit (?!0)/);
  });

  it("apply_patch updates file", async () => {
    const file = path.join(sandbox, "patch.txt");
    await fs.writeFile(file, "old\n", "utf8");
    const patch = [
      "--- a/patch.txt",
      "+++ b/patch.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const result = await toolHandlers.apply_patch({ path: "patch.txt", patch });
    expect(result.output).toContain("Patched patch.txt");
    const updated = await fs.readFile(file, "utf8");
    expect(updated.trim()).toBe("new");
  });

  it("apply_patch supports dryRun and reports failures", async () => {
    const file = path.join(sandbox, "dry.txt");
    await fs.writeFile(file, "hello\n", "utf8");
    const patch = [
      "--- a/dry.txt",
      "+++ b/dry.txt",
      "@@ -1 +1 @@",
      "-hello",
      "+hi",
      "",
    ].join("\n");
    const dry = await toolHandlers.apply_patch({ path: "dry.txt", patch, dryRun: true });
    expect(dry.output).toContain("Dry-run OK");
    const unchanged = await fs.readFile(file, "utf8");
    expect(unchanged.trim()).toBe("hello");

    const badPatch = [
      "--- a/dry.txt",
      "+++ b/dry.txt",
      "@@ -1 +1 @@",
      "-missing",
      "+oops",
      "",
    ].join("\n");
    const failed = await toolHandlers.apply_patch({ path: "dry.txt", patch: badPatch });
    expect(failed.error).toBeTrue();
    expect(failed.output).toContain("Patch could not be applied");
  });

  it("create_file creates new files (no overwrite by default)", async () => {
    const file = path.join(sandbox, "nested/created.txt");
    const created = await toolHandlers.create_file({ path: "nested/created.txt", content: "hello" });
    expect(created.output).toContain("Created nested/created.txt");
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe("hello");
    await expect(toolHandlers.create_file({ path: "nested/created.txt", content: "again" })).rejects.toThrow();
    const forced = await toolHandlers.create_file({ path: "nested/created.txt", content: "again", overwrite: true });
    expect(forced.output).toContain("Created nested/created.txt");
    const updated = await fs.readFile(file, "utf8");
    expect(updated).toBe("again");
  });

  it("list_dir lists directory contents and skips ignored by default", async () => {
    await fs.mkdir(path.join(sandbox, "dir/.git"), { recursive: true });
    await fs.mkdir(path.join(sandbox, "dir/node_modules"), { recursive: true });
    await fs.writeFile(path.join(sandbox, "dir/file.txt"), "x", "utf8");
    const result = await toolHandlers.list_dir({ path: "dir" });
    expect(result.output).toContain("file.txt");
    expect(result.output).not.toContain("node_modules/");
    expect(result.output).not.toContain(".git/");
    const all = await toolHandlers.list_dir({ path: "dir", includeIgnored: true });
    expect(all.output).toContain("node_modules/");
    expect(all.output).toContain(".git/");
  });

  it("manage_todo adds and completes items", async () => {
    const added = await toolHandlers.manage_todo({ action: "add", title: "task" });
    expect(added.output).toContain("Added 1. task");
    const listed = await toolHandlers.manage_todo({ action: "list" });
    expect(listed.output).toContain("1. [not-started] task");
    const done = await toolHandlers.manage_todo({ action: "done", id: 1 });
    expect(done.output).toContain("Completed 1. task");
  });

  it("manage_todo can set status", async () => {
    await toolHandlers.manage_todo({ action: "add", title: "task" });
    const updated = await toolHandlers.manage_todo({ action: "set_status", id: 1, status: "in-progress" });
    expect(updated.output).toContain("Set 1 to in-progress");
    const listed = await toolHandlers.manage_todo({ action: "list" });
    expect(listed.output).toContain("[in-progress] task");
  });

  it("web_fetch returns data URL content", async () => {
    const result = await toolHandlers.web_fetch({ url: "data:text/plain,hello", maxBytes: 100 });
    expect(result.output).toContain("hello");
  });

  it("web_fetch can strip HTML and report content type", async () => {
    const html = "<html><body><p>Hello World</p></body></html>";
    const result = await toolHandlers.web_fetch({ url: `data:text/html,${encodeURIComponent(html)}`, textOnly: true });
    expect(result.output).toContain("content-type: text/html");
    expect(result.output).toContain("Hello World");
    expect(result.output).not.toContain("<html>");
  });
});
