import { describe, it, expect } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("execute", () => {
  it("runs a command", async () => {
    const sandbox = getSandbox();
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const result = await toolHandlers.execute({ command: "pwd" });
    expect(result.output).toContain("exit 0");
    expect(result.output).toContain(sandbox);
  });

  it("is gated by STEWARD_ALLOW_EXECUTE", async () => {
    delete process.env.STEWARD_ALLOW_EXECUTE;
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
  });

  it("honors cwd, env, and timeout", async () => {
    const sandbox = getSandbox();
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const subdir = path.join(sandbox, "sub");
    await fs.mkdir(subdir);
    const result = await toolHandlers.execute({ command: "pwd", cwd: "sub", env: { FOO: "BAR" } });
    expect(result.output).toContain("sub");
    const timeoutResult = await toolHandlers.execute({ command: "sleep", args: ["2"], timeoutMs: 100 });
    expect(timeoutResult.output).toMatch(/exit (?!0)/);
  });

  it("respects allow and deny lists", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_ALLOW = "echo";
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
    const allowed = await toolHandlers.execute({ command: "echo", args: ["ok"], stream: true });
    expect(allowed.output.trim()).toBe("ok");
    process.env.STEWARD_EXEC_ALLOW = "";
    process.env.STEWARD_EXEC_DENY = "pwd";
    await expect(toolHandlers.execute({ command: "pwd" })).rejects.toThrow();
  });

  it("supports background mode", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const bg = await toolHandlers.execute({ command: "sleep", args: ["1"], background: true });
    expect(bg.output).toContain("started pid");
  });

  it("supports streaming mode", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const res = await toolHandlers.execute({ command: "printf", args: ["hello"], stream: true });
    expect(res.output.trim()).toBe("hello");
  });

  it("caps output size", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    const res = await toolHandlers.execute({ command: "node", args: ["-e", "console.log('x'.repeat(50000))"], maxOutputBytes: 2000 });
    expect(res.output).toContain("[truncated]");
  });

  it("uses env default output cap", async () => {
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_MAX_OUTPUT_BYTES = "100";
    const res = await toolHandlers.execute({ command: "node", args: ["-e", "console.log('x'.repeat(5000))"] });
    expect(res.output).toContain("[truncated]");
  });

  it("writes audit log", async () => {
    const sandbox = getSandbox();
    process.env.STEWARD_ALLOW_EXECUTE = "1";
    process.env.STEWARD_EXEC_AUDIT = "1";
    await toolHandlers.execute({ command: "echo", args: ["hi"], stream: true });
    const logPath = path.join(sandbox, ".steward-exec-audit.log");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toContain("\"cmd\":\"echo\"");
  });
});
