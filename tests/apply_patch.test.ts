import { describe, it, expect } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("apply_patch", () => {
  it("updates file", async () => {
    const sandbox = getSandbox();
    const file = path.join(sandbox, "patch.txt");
    await fs.writeFile(file, "old\n", "utf8");
    const patch = ["--- a/patch.txt", "+++ b/patch.txt", "@@ -1 +1 @@", "-old", "+new", ""].join("\n");
    const result = await toolHandlers.apply_patch({ path: "patch.txt", patch });
    expect(result.output).toContain("Patched patch.txt");
    const updated = await fs.readFile(file, "utf8");
    expect(updated.trim()).toBe("new");
  });

  it("supports dryRun and reports failures", async () => {
    const sandbox = getSandbox();
    const file = path.join(sandbox, "dry.txt");
    await fs.writeFile(file, "hello\n", "utf8");
    const patch = ["--- a/dry.txt", "+++ b/dry.txt", "@@ -1 +1 @@", "-hello", "+hi", ""].join("\n");
    const dry = await toolHandlers.apply_patch({ path: "dry.txt", patch, dryRun: true });
    expect(dry.output).toContain("Dry-run OK");
    const unchanged = await fs.readFile(file, "utf8");
    expect(unchanged.trim()).toBe("hello");

    const badPatch = ["--- a/dry.txt", "+++ b/dry.txt", "@@ -1 +1 @@", "-missing", "+oops", ""].join("\n");
    const failed = await toolHandlers.apply_patch({ path: "dry.txt", patch: badPatch });
    expect(failed.error).toBe(true);
    expect(failed.output).toContain("Patch could not be applied");
  });

  it("supports batch patches", async () => {
    const sandbox = getSandbox();
    await fs.writeFile(path.join(sandbox, "a.txt"), "a\n", "utf8");
    await fs.writeFile(path.join(sandbox, "b.txt"), "b\n", "utf8");
    const patches = [
      ["--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-a", "+aa", ""].join("\n"),
      ["--- a/b.txt", "+++ b/b.txt", "@@ -1 +1 @@", "-b", "+bb", ""].join("\n"),
    ];
    const dry = await toolHandlers.apply_patch({
      patches: [
        { path: "a.txt", patch: patches[0] },
        { path: "b.txt", patch: patches[1] },
      ],
      dryRun: true,
    });
    expect(dry.output).toContain("Dry-run OK for 2 file(s)");
    const applied = await toolHandlers.apply_patch({
      patches: [
        { path: "a.txt", patch: patches[0] },
        { path: "b.txt", patch: patches[1] },
      ],
    });
    expect(applied.output).toContain("Patched 2 file(s)");
    const a = await fs.readFile(path.join(sandbox, "a.txt"), "utf8");
    const b = await fs.readFile(path.join(sandbox, "b.txt"), "utf8");
    expect(a.trim()).toBe("aa");
    expect(b.trim()).toBe("bb");
  });
});
