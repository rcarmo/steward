import { describe, it, expect } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toolHandlers } from "../src/tools/index.ts";
import { useSandbox } from "./test_utils.ts";

const getSandbox = useSandbox();

describe("grep_search", () => {
  it("finds matches", async () => {
    const sandbox = getSandbox();
    await fs.writeFile(path.join(sandbox, "search.txt"), "hello world\nbye\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hello" });
    expect(result.output).toContain("search.txt:1: hello world");
  });

  it("respects include/exclude filters and maxResults", async () => {
    const sandbox = getSandbox();
    await fs.mkdir(path.join(sandbox, "skip"));
    await fs.mkdir(path.join(sandbox, "keep"));
    await fs.writeFile(path.join(sandbox, "skip/hit.txt"), "hello\n", "utf8");
    await fs.writeFile(path.join(sandbox, "keep/hit.txt"), "hello\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hello", excludePath: "skip", maxResults: 1 });
    expect(result.output).toContain("keep/hit.txt:1: hello");
    expect(result.output).not.toContain("skip/hit.txt");
    const lines = result.output.split(/\n/).filter(Boolean);
    expect(lines.length).toBe(1);
    const globResult = await toolHandlers.grep_search({ pattern: "hello", includeGlob: "keep/**" });
    expect(globResult.output).toContain("keep/hit.txt:1: hello");
    expect(globResult.output).not.toContain("skip/hit.txt");
  });

  it("supports context, smartCase, fixed, word, hidden toggle", async () => {
    const sandbox = getSandbox();
    await fs.mkdir(path.join(sandbox, ".hidden"));
    await fs.writeFile(path.join(sandbox, "sample.txt"), "one\nHello world\nthree\n", "utf8");
    await fs.writeFile(path.join(sandbox, ".hidden/inside.txt"), "Hello hidden\n", "utf8");
    const ctx = await toolHandlers.grep_search({ pattern: "hello", smartCase: true, contextLines: 1 });
    expect(ctx.output).toContain("sample.txt:1: one");
    expect(ctx.output).toContain("sample.txt:2: Hello world");
    expect(ctx.output).toContain("sample.txt:3: three");
    const fixed = await toolHandlers.grep_search({ pattern: "Hello", fixedString: true, wordMatch: true, caseSensitive: true });
    expect(fixed.output).toContain("sample.txt:2: Hello world");
    const hidden = await toolHandlers.grep_search({ pattern: "hidden", includeHidden: true });
    expect(hidden.output).toContain(".hidden/inside.txt:1: Hello hidden");
    const labeled = await toolHandlers.grep_search({ pattern: "hello", contextLines: 1, withContextLabels: true });
    expect(labeled.output).toContain("M: Hello world");
    expect(labeled.output).toContain("C: one");
    const maxed = await toolHandlers.grep_search({ pattern: "x", maxFileBytes: 1 });
    expect(maxed.output).toBe("No matches");
  });

  it("supports asymmetric context and separators", async () => {
    const sandbox = getSandbox();
    await fs.writeFile(path.join(sandbox, "ctx.txt"), "zero\none\ntwo\nthree\nfour\n", "utf8");
    const result = await toolHandlers.grep_search({
      pattern: "one|three",
      regex: true,
      beforeContext: 1,
      afterContext: 0,
      withContextSeparators: true,
    });
    const lines = result.output.split(/\n/).filter(Boolean);
    expect(lines[0]).toContain("ctx.txt:1: zero");
    expect(lines[1]).toContain("ctx.txt:2: one");
    expect(lines[2]).toBe("--");
    expect(lines[3]).toContain("ctx.txt:3: two");
    expect(lines[4]).toContain("ctx.txt:4: three");
  });

  it("can emit headings and counts", async () => {
    const sandbox = getSandbox();
    await fs.writeFile(path.join(sandbox, "f1.txt"), "hit one\nmiss\n", "utf8");
    await fs.writeFile(path.join(sandbox, "f2.txt"), "hit two\nhit three\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hit", withHeadings: true, withCounts: true });
    expect(result.output).toContain("f1.txt (1 match)");
    expect(result.output).toContain("f2.txt (2 matches)");
    expect(result.output).toContain("f1.txt:1:");
    expect(result.output).toContain("f2.txt:1:");
  });

  it("uses env default maxResults", async () => {
    const sandbox = getSandbox();
    process.env.STEWARD_SEARCH_MAX_RESULTS = "1";
    await fs.writeFile(path.join(sandbox, "a.txt"), "hello\nhello\n", "utf8");
    await fs.writeFile(path.join(sandbox, "b.txt"), "hello\n", "utf8");
    const result = await toolHandlers.grep_search({ pattern: "hello" });
    const lines = result.output.split(/\n/).filter(Boolean);
    expect(lines.length).toBe(1);
  });
});
