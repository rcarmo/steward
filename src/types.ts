export type Role = "system" | "user" | "assistant" | "tool";

export type ToolCallDescriptor = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type Message = {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallDescriptor[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolResult = {
  id: string;
  output: string;
  error?: boolean;
};

export interface LLMClient {
  generate(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }>;
}
