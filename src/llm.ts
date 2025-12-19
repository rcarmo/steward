import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { LLMClient, Message, ToolCallDescriptor, ToolDefinition } from "./types.ts";

class EchoClient implements LLMClient {
  async generate(messages: Message[]): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return { content: lastUser?.content ? `Echo: ${lastUser.content}` : "Echo" };
  }
}

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(model: string, apiKey: string, baseURL?: string, defaultQuery?: Record<string, string>) {
    if (!apiKey) {
      throw new Error("STEWARD_OPENAI_API_KEY (or Azure key) is required for this provider");
    }
    this.client = new OpenAI({ apiKey, baseURL, defaultQuery });
    this.model = model;
  }

  async generate(messages: Message[], tools?: ToolDefinition[]): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(messages),
      tools: tools?.map(toOpenAITool),
      tool_choice: tools && tools.length ? "auto" : undefined,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) return { content: null };
    const toolCalls = choice.tool_calls?.map((call) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = {};
      }
      return {
        id: call.id,
        name: call.function.name,
        arguments: args,
      } satisfies ToolCallDescriptor;
    });

    const content = typeof choice.content === "string" ? choice.content : null;
    return { content, toolCalls };
  }
}

export function buildClient(provider: string, model: string): LLMClient {
  if (provider === "openai") {
    const apiKey = process.env.STEWARD_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    const baseURL = process.env.STEWARD_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL;
    return new OpenAIClient(model, apiKey ?? "", baseURL);
  }
  if (provider === "azure") {
    const endpoint = process.env.STEWARD_AZURE_OPENAI_ENDPOINT ?? process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.STEWARD_AZURE_OPENAI_KEY ?? process.env.AZURE_OPENAI_KEY;
    const deployment = process.env.STEWARD_AZURE_OPENAI_DEPLOYMENT ?? process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiVersion = process.env.STEWARD_AZURE_OPENAI_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-01-preview";
    if (!endpoint || !apiKey || !deployment) {
      throw new Error("Azure provider requires endpoint, key, and deployment (STEWARD_AZURE_OPENAI_ENDPOINT/KEY/DEPLOYMENT)");
    }
    const baseURL = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}`;
    return new OpenAIClient(model, apiKey, baseURL, { "api-version": apiVersion });
  }
  return new EchoClient();
}

function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls) {
      return {
        role: "assistant",
        content: m.content ?? "",
        tool_calls: m.tool_calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      } satisfies ChatCompletionMessageParam;
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content ?? "",
        tool_call_id: m.tool_call_id ?? "",
      } satisfies ChatCompletionMessageParam;
    }
    return { role: m.role, content: m.content ?? "" } satisfies ChatCompletionMessageParam;
  });
}

function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  } satisfies ChatCompletionTool;
}
