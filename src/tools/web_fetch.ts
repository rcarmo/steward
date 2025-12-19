import { Buffer } from "node:buffer";
import type { ToolDefinition } from "../types.ts";
import { envInt, inferContentType, stripHtml } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

export const webFetchDefinition: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch content from a URL (truncated, optional text-only)",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      maxBytes: { type: "number" },
      textOnly: { type: "boolean" },
    },
    required: ["url"],
  },
};

export const webFetchTool: ToolHandler = async (args) => {
  const url = args.url;
  const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : envInt("STEWARD_WEB_MAX_BYTES", 24_000);
  const textOnly = args.textOnly === true;
  if (typeof url !== "string") throw new Error("'url' must be a string");
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const limited = buf.subarray(0, maxBytes);
  const text = limited.toString("utf8");
  const output = textOnly ? stripHtml(text) : text;
  const headerCtype = res.headers.get("content-type") ?? "";
  const inferred = inferContentType(url) ?? headerCtype;
  return { id: "web", output: `content-type: ${inferred}\n${output}` };
};
