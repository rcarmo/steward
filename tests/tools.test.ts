import { beforeEach, afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHandlers } from "../src/tools.ts";

const rootCwd = process.cwd();
let sandbox: string;
const originalEnv = { ...process.env };

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "steward-"));
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

  it("read_file respects env caps when unspecified", async () => {
    process.env.STEWARD_READ_MAX_BYTES = "50";
    const big = "x".repeat(500);
    await fs.writeFile(path.join(sandbox, "env.txt"), big, "utf8");
    const result = await toolHandlers.read_file({ path: "env.txt" });
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
    const result = await toolHandlers.grep_search({ pattern: "hello", excludePath: "skip", maxResults: 1 });
    expect(result.output).toContain("keep/hit.txt:1: hello");
    expect(result.output).not.toContain("skip/hit.txt");
    const lines = result.output.split(/\n/).filter(Boolean);
    expect(lines.length).toBe(1);
    const globResult = await toolHandlers.grep_search({ pattern: "hello", includeGlob: "keep/**" });
    expect(globResult.output).toContain("keep/hit.txt:1: hello");
    expect(globResult.output).not.toContain("skip/hit.txt");
  });

  it("grep_search supports context, smartCase, fixed, word, hidden toggle", async () => {
    await fs.mkdir(path.join(sandbox, ".hidden"));
    await fs.writeFile(path.join(sandbox, "sample.txt"), "one\nHello world\nthree\n", "utf8");
    await fs.writeFile(path.join(sandbox, ".hidden/inside.txt"), "Hello hidden\n", "utf8");
    const ctx = await toolHandlers.grep_search({ pattern: "hello", smartCase: true, contextLines: 1 });
    expect(ctx.output).toContain("sample.txt:1: one");
    expect(ctx.output).toContain("sample.txt:2: Hello world");
    expect(ctx.output).toContain("sample.txt:3: three");
    const fixed = await toolHandlers.grep_search({ pattern: "Hello", fixedString: true, wordMatch: true, caseSensitive: true });
    expect(fixed.output).toContain("sample.txt:2: Hello world");
    const hidden = await toolHandlers.grep_search({ pattern: "hidden", includeHidden: true });
    expect(hidden.output).toContain(".hidden/inside.txt:1: Hello hidden");
    const labeled = await toolHandlers.grep_search({ pattern: "hello", contextLines: 1, withContextLabels: true });
    expect(labeled.output).toContain("M: Hello world");
    expect(labeled.output).toContain("C: one");
    const maxed = await toolHandlers.grep_search({ pattern: "x", maxFileBytes: 1 });
    expect(maxed.output).toBe("No matches");
  });

  it("grep_search supports asymmetric context and separators", async () => {
    await fs.writeFile(path.join(sandbox, "ctx.txt"), "zero\none\ntwo\nthree\nfour\n", "utf8");
    const result = await toolHandlers.grep_search({
      pattern: "one|three",
      regex: true,
      beforeContext: 1,
      afterContext: 0,
      withContextSeparators: true,
    });
    const lines = result.output.split(/\n/).filter(Boolean);
    expect(lines[0]).toContain("ctx.txt:1: zero");
    expect(lines[1]).toContain("ctx.txt:2: one");
    expect(lines[2]).toBe("--");
    expect(lines[3]).toContain("ctx.txt:3: two");
    expect(lines[4]).toContain("ctx.txt:4: three");
  });

  it("grep_search can emit headings and counts", async () => {
    await fs.writeFile(path.join(sandbox, "f1.txt"), "hit one\nmiss\n", "utf8");
    await fs.writeFile(path.join(sandbox, "f2.txt"), "hit two\nhit three\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hit", withHeadings: true, withCounts: true });
    expect(result.output).toContain("f1.txt (1 match)");
    expect(result.output).toContain("f2.txt (2 matches)");
    expect(result.output).toContain("f1.txt:1:");
    expect(result.output).toContain("f2.txt:1:");
  });

  it("grep_search uses env default maxResults", async () => {
    process.env.STEWARD_SEARCH_MAX_RESULTS = "1";
    await fs.writeFile(path.join(sandbox, "a.txt"), "hello\nhello\n", "utf8");
    await fs.writeFile(path.join(sandbox, "b.txt"), "hello\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hello" });
    const lines = result.output.split(/\n/).filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it("execute runs a command", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const result = await toolHandlers.execute({ command: "pwd" });
    expect(result.output).toContain("exit 0");
    expect(result.output).toContain(sandbox);
  });

  it("execute is gated by STEWARD_ALLOW_EXECUTE", async () => {
    delete process.env.STEWARD_ALLOW_EXECUTE;
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
  });

  it("execute honors cwd, env, and timeout", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const subdir = path.join(sandbox, "sub");
    await fs.mkdir(subdir);
    const result = await toolHandlers.execute({ command: "pwd", cwd: "sub", env: { FOO: "BAR" } });
    expect(result.output).toContain("sub");
    const timeoutResult = await toolHandlers.execute({ command: "sleep", args: ["2"], timeoutMs: 100 });
    expect(timeoutResult.output).toMatch(/exit (?!0)/);
  });

  it("execute respects allow and deny lists", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_ALLOW = "echo";
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
    const allowed = await toolHandlers.execute({ command: "echo", args: ["ok"], stream: true });
    expect(allowed.output.trim()).toBe("ok");
    process.env.STEWARD_EXEC_ALLOW = "";
    process.env.STEWARD_EXEC_DENY = "pwd";
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
  });

  it("execute supports background mode", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const bg = await toolHandlers.execute({ command: "sleep", args: ["1"], background: true });
    expect(bg.output).toContain("started pid");
  });

  it("execute supports streaming mode", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const res = await toolHandlers.execute({ command: "printf", args: ["hello"], stream: true });
    expect(res.output.trim()).toBe("hello");
  });

  it("execute caps output size", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const res = await toolHandlers.execute({ command: "node", args: ["-e", "console.log('x'.repeat(50000))"], maxOutputBytes: 2000 });
    expect(res.output).toContain("[truncated]");
  });

  it("execute uses env default output cap", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_MAX_OUTPUT_BYTES = "100";
    const res = await toolHandlers.execute({ command: "node", args: ["-e", "console.log('x'.repeat(5000))"] });
    expect(res.output).toContain("[truncated]");
  });

  it("execute writes audit log", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_AUDIT = "1";
    await toolHandlers.execute({ command: "echo", args: ["hi"], stream: true });
    const logPath = path.join(sandbox, ".steward-exec-audit.log");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("\"cmd\":\"echo\"");
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

  it("apply_patch supports batch patches", async () => {
    await fs.writeFile(path.join(sandbox, "a.txt"), "a\n", "utf8");
    await fs.writeFile(path.join(sandbox, "b.txt"), "b\n", "utf8");
    const patches = [
      ["--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-a", "+aa", ""].join("\n"),
      ["--- a/b.txt", "+++ b/b.txt", "@@ -1 +1 @@", "-b", "+bb", ""].join("\n"),
    ];
    const dry = await toolHandlers.apply_patch({ patches: [
      { path: "a.txt", patch: patches[0] },
      { path: "b.txt", patch: patches[1] },
    ], dryRun: true });
    expect(dry.output).toContain("Dry-run OK for 2 file(s)");
    const applied = await toolHandlers.apply_patch({ patches: [
      { path: "a.txt", patch: patches[0] },
      { path: "b.txt", patch: patches[1] },
    ] });
    expect(applied.output).toContain("Patched 2 file(s)");
    const a = await fs.readFile(path.join(sandbox, "a.txt"), "utf8");
    const b = await fs.readFile(path.join(sandbox, "b.txt"), "utf8");
    expect(a.trim()).toBe("aa");
    expect(b.trim()).toBe("bb");
  });

  it("git_status and git_diff work", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    await toolHandlers.execute({ command: "git", args: ["init"], stream: true, maxOutputBytes: 2000, cwd: sandbox, env: {} });
    await toolHandlers.execute({ command: "git", args: ["config", "user.email", "test@example.com"], stream: true, cwd: sandbox, env: {} });
    await toolHandlers.execute({ command: "git", args: ["config", "user.name", "Tester"], stream: true, cwd: sandbox, env: {} });
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
    await toolHandlers.execute({ command: "git", args: ["init"], stream: true, cwd: sandbox, env: {} });
    await toolHandlers.execute({ command: "git", args: ["config", "user.email", "test@example.com"], stream: true, cwd: sandbox, env: {} });
    await toolHandlers.execute({ command: "git", args: ["config", "user.name", "Tester"], stream: true, cwd: sandbox, env: {} });
    await fs.writeFile(path.join(sandbox, "c.txt"), "one\n", "utf8");
    await toolHandlers.execute({ command: "git", args: ["add", "c.txt"], stream: true, cwd: sandbox, env: {} });
    const commit = await toolHandlers.git_commit({ path: sandbox, message: "init commit" });
    expect(commit.output).toContain("exit 0");
    const status = await toolHandlers.git_status({ path: sandbox });
    expect(status.output).toContain("exit 0");
    expect(status.output).not.toMatch(/\n\?\?/); // no untracked files
    expect(status.output).not.toMatch(/\n [MAD]/); // no pending changes
  });

  it("git_stash saves and restores changes", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    await toolHandlers.execute({ command: "git", args: ["init"], stream: true, cwd: sandbox, env: {} });
    await toolHandlers.execute({ command: "git", args: ["config", "user.email", "test@example.com"], stream: true, cwd: sandbox, env: {} });
    await toolHandlers.execute({ command: "git", args: ["config", "user.name", "Tester"], stream: true, cwd: sandbox, env: {} });
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

  it("workspace_summary reports package info and top-level entries", async () => {
    await fs.writeFile(path.join(sandbox, "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0" }));
    await fs.mkdir(path.join(sandbox, "src"));
    await fs.writeFile(path.join(sandbox, "file.txt"), "x");
    const summary = await toolHandlers.workspace_summary({});
    expect(summary.output).toContain("package: pkg@1.0.0");
    expect(summary.output).toContain("dirs: src");
    expect(summary.output).toContain("files: file.txt");
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

  it("rejects paths that escape via symlink", async () => {
    const outside = path.join(rootCwd, "outside.txt");
    await fs.writeFile(outside, "oops", "utf8");
    await fs.symlink(outside, path.join(sandbox, "link.txt"));
    await expect(toolHandlers.read_file({ path: "link.txt" })).rejects.toThrow();
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

  it("web_fetch respects env default maxBytes", async () => {
    process.env.STEWARD_WEB_MAX_BYTES = "10";
    const result = await toolHandlers.web_fetch({ url: "data:text/plain,hello-world" });
    const body = result.output.split("\n").slice(1).join("\n");
    expect(body.length).toBeLessThanOrEqual(10 + 5); // allow small header prefix variance
  });
});
