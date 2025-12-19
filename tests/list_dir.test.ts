import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("list_dir", () => {
  it("lists directory contents and handles ignored entries", async () => {
    const sandbox = getSandbox();
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
});
