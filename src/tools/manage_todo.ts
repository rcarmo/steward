import path from "node:path";
import type { ToolDefinition } from "../types.ts";
import { isTodoStatus, readTodo, writeTodo, type TodoStatus } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

const TODO_FILE = ".steward-todo.json";

export const manageTodoDefinition: ToolDefinition = {
  name: "manage_todo",
  description: "Manage a simple todo list",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "done", "set_status"] },
      title: { type: "string" },
      id: { type: "number" },
      status: { type: "string", enum: ["not-started", "in-progress", "blocked", "done"] },
    },
    required: ["action"],
  },
};

export const manageTodoTool: ToolHandler = async (args) => {
  const action = args.action;
  const title = typeof args.title === "string" ? args.title.trim() : undefined;
  const file = path.join(process.cwd(), TODO_FILE);
  const todo = await readTodo(file);

  if (action === "list") {
    const body = todo.items
      .map((item) => `${item.id}. [${item.status}] ${item.title}`)
      .join("\n");
    return { id: "todo", output: body || "No todos" };
  }
  if (action === "add") {
    if (!title) throw new Error("'title' required for add");
    const next = { id: todo.nextId++, title, status: "not-started" as TodoStatus };
    todo.items.push(next);
    await writeTodo(file, todo);
    return { id: "todo", output: `Added ${next.id}. ${next.title}` };
  }
  if (action === "done") {
    const id = typeof args.id === "number" ? args.id : undefined;
    if (id === undefined) throw new Error("'id' required for done");
    const item = todo.items.find((t) => t.id === id);
    if (!item) throw new Error(`Todo ${id} not found`);
    item.status = "done";
    await writeTodo(file, todo);
    return { id: "todo", output: `Completed ${id}. ${item.title}` };
  }
  if (action === "set_status") {
    const id = typeof args.id === "number" ? args.id : undefined;
    const status = typeof args.status === "string" ? args.status : undefined;
    if (id === undefined || !status) throw new Error("'id' and 'status' required for set_status");
    if (!isTodoStatus(status)) throw new Error("Invalid status");
    const item = todo.items.find((t) => t.id === id);
    if (!item) throw new Error(`Todo ${id} not found`);
    item.status = status;
    await writeTodo(file, todo);
    return { id: "todo", output: `Set ${id} to ${status}` };
  }
  throw new Error("Unsupported todo action");
};
