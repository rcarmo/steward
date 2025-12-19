import { buildClient } from "./llm.ts";
import { toolDefinitions, toolHandlers } from "./tools.ts";
import type { Message } from "./types.ts";

export type RunnerOptions = {
  prompt: string;
  systemPrompt?: string;
  maxSteps?: number;
  provider?: string;
  model?: string;
};

export async function runHarness(options: RunnerOptions) {
  const client = buildClient(options.provider ?? "echo", options.model ?? "gpt-4o-mini");
  const messages: Message[] = [];

  const system = options.systemPrompt ?? defaultSystemPrompt();
  messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: options.prompt });

  const limit = options.maxSteps ?? 8;
  for (let step = 0; step < limit; step++) {
    const response = await client.generate(messages, toolDefinitions);
    if (response.toolCalls?.length) {
      messages.push({ role: "assistant", content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        const handler = toolHandlers[call.name];
        if (!handler) {
          messages.push({ role: "tool", content: `Unknown tool ${call.name}`, tool_call_id: call.id });
          continue;
        }
        try {
          const result = await handler(call.arguments);
          console.log(`tool ${call.name} -> ${result.output}`);
          messages.push({ role: "tool", content: result.output, tool_call_id: call.id });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`tool ${call.name} error: ${errorMsg}`);
          messages.push({ role: "tool", content: `error: ${errorMsg}`, tool_call_id: call.id });
        }
      }
      continue;
    }

    if (response.content) {
      console.log(response.content);
      return;
    }
  }

  console.warn("Reached max steps without final response");
}

function defaultSystemPrompt() {
  return [
    "You are GitHub Copilot running in a local CLI harness.",
    "Tools: read_file, grep_search, execute, apply_patch, manage_todo, web_fetch.",
    "Stay within the current workspace; do not invent files or paths.",
    "Use tools to gather context before editing. Keep replies short and task-focused.",
    "When finished, provide a brief result and, if relevant, next steps.",
  ].join("\n");
}
