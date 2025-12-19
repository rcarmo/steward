import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("create_file", () => {
  it("creates new files and supports overwrite", async () => {
    const sandbox = getSandbox();
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
});
