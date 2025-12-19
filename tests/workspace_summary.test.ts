import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("workspace_summary", () => {
  it("reports package info and top-level entries", async () => {
    const sandbox = getSandbox();
    await fs.writeFile(path.join(sandbox, "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0" }));
    await fs.mkdir(path.join(sandbox, "src"));
    await fs.writeFile(path.join(sandbox, "file.txt"), "x");
    const summary = await toolHandlers.workspace_summary({});
    expect(summary.output).toContain("package: pkg@1.0.0");
    expect(summary.output).toContain("dirs: src");
    expect(summary.output).toContain("files: file.txt");
  });
});
