import { describe, expect, it } from "bun:test";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

useSandbox();

describe("web_fetch", () => {
  it("returns data URL content", async () => {
    const result = await toolHandlers.web_fetch({ url: "data:text/plain,hello", maxBytes: 100 });
    expect(result.output).toContain("hello");
  });

  it("can strip HTML and report content type", async () => {
    const html = "<html><body><p>Hello World</p></body></html>";
    const result = await toolHandlers.web_fetch({ url: `data:text/html,${encodeURIComponent(html)}`, textOnly: true });
    expect(result.output).toContain("content-type: text/html");
    expect(result.output).toContain("Hello World");
    expect(result.output).not.toContain("<html>");
  });

  it("respects env default maxBytes", async () => {
    process.env.STEWARD_WEB_MAX_BYTES = "10";
    const result = await toolHandlers.web_fetch({ url: "data:text/plain,hello-world" });
    const body = result.output.split("\n").slice(1).join("\n");
    expect(body.length).toBeLessThanOrEqual(15);
  });
});
