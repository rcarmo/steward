import { describe, it, expect } from "bun:test";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

useSandbox();

describe("run_js", () => {
  it("executes code in QuickJS", async () => {
    const result = await toolHandlers.run_js({ code: "console.log('hi'); 1 + 2;" });
    expect(result.output).toContain("status: ok");
    expect(result.output).toContain("result: 3");
    expect(result.output).toContain("console:");
    expect(result.output).toContain("log: hi");
  });

  it("enforces timeouts", async () => {
    const result = await toolHandlers.run_js({ code: "while(true) {}", timeoutMs: 50 });
    expect(result.error).toBeTrue();
    expect(result.output).toContain("status: timeout");
  });
});
