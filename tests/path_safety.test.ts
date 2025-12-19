import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("path safety", () => {
  it("rejects paths that escape via symlink", async () => {
    const sandbox = getSandbox();
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "steward-outside-"));
    const outside = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outside, "oops", "utf8");
    const linkPath = path.join(sandbox, "link.txt");
    await fs.symlink(outside, linkPath);
    await expect(toolHandlers.read_file({ path: "link.txt" })).rejects.toThrow();
    await fs.rm(outsideDir, { recursive: true, force: true });
  });
});
