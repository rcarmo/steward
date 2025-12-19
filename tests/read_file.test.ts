import { describe, it, expect } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("read_file", () => {
  it("reads file content within range", async () => {
    const sandbox = getSandbox();
    await fs.writeFile(path.join(sandbox, "sample.txt"), "one\ntwo\nthree\n", "utf8");
    const result = await toolHandlers.read_file({ path: "sample.txt", startLine: 1, endLine: 2 });
    expect(result.output).toContain("Lines 1-2:");
    expect(result.output).toContain("one\ntwo");
  });

  it("truncates by lines and bytes", async () => {
    const sandbox = getSandbox();
    const big = "x".repeat(20_000);
    await fs.writeFile(path.join(sandbox, "big.txt"), big, "utf8");
    const result = await toolHandlers.read_file({ path: "big.txt", maxBytes: 100, maxLines: 1 });
    expect(result.output).toContain("Lines 1-1:");
    expect(result.output).toContain("[truncated]");
  });

  it("respects env caps when unspecified", async () => {
    const sandbox = getSandbox();
    process.env.STEWARD_READ_MAX_BYTES = "50";
    const big = "x".repeat(500);
    await fs.writeFile(path.join(sandbox, "env.txt"), big, "utf8");
    const result = await toolHandlers.read_file({ path: "env.txt" });
    expect(result.output).toContain("[truncated]");
  });
});
