import { describe, expect, it } from "bun:test";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("manage_todo", () => {
  it("adds, lists, and completes items", async () => {
    getSandbox();
    const added = await toolHandlers.manage_todo({ action: "add", title: "task" });
    expect(added.output).toContain("Added 1. task");
    const listed = await toolHandlers.manage_todo({ action: "list" });
    expect(listed.output).toContain("1. [not-started] task");
    const done = await toolHandlers.manage_todo({ action: "done", id: 1 });
    expect(done.output).toContain("Completed 1. task");
  });

  it("can set status", async () => {
    getSandbox();
    await toolHandlers.manage_todo({ action: "add", title: "task" });
    const updated = await toolHandlers.manage_todo({ action: "set_status", id: 1, status: "in-progress" });
    expect(updated.output).toContain("Set 1 to in-progress");
    const listed = await toolHandlers.manage_todo({ action: "list" });
    expect(listed.output).toContain("[in-progress] task");
  });
});
