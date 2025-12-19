import { getQuickJS, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from "quickjs-emscripten";
import type { ToolDefinition } from "../types.ts";
import { envInt, truncateOutput } from "./shared.ts";
import type { ToolHandler } from "./shared.ts";

const JS_DEFAULT_TIMEOUT_MS = envInt("STEWARD_JS_TIMEOUT_MS", 2_000);
const JS_MAX_OUTPUT_BYTES = envInt("STEWARD_JS_MAX_OUTPUT_BYTES", 16_000);
let quickJsModulePromise: Promise<QuickJSWASMModule> | null = null;

export const runJsDefinition: ToolDefinition = {
  name: "run_js",
  description: "Execute JavaScript in a sandboxed QuickJS runtime",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string" },
      timeoutMs: { type: "number" },
      maxOutputBytes: { type: "number" },
      sandboxDir: { type: "string" },
      allowNetwork: { type: "boolean" },
    },
    required: ["code"],
  },
};

export const runJsTool: ToolHandler = async (args) => {
  const code = typeof args.code === "string" ? args.code : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) ? Math.max(1, args.timeoutMs) : JS_DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = typeof args.maxOutputBytes === "number" && Number.isFinite(args.maxOutputBytes)
    ? Math.max(1, args.maxOutputBytes)
    : JS_MAX_OUTPUT_BYTES;
  const allowNetwork = args.allowNetwork === true;
  const sandboxRoot = typeof args.sandboxDir === "string" ? args.sandboxDir : "/sandbox";
  if (!code) throw new Error("'code' must be a string");

  const quickjs = await loadQuickJSModule();
  const runtime = quickjs.newRuntime();
  const context = runtime.newContext();
  // Defensive: strip common host hooks if present
  context.setProp(context.global, "process", context.undefined);
  context.setProp(context.global, "require", context.undefined);
  context.setProp(context.global, "fs", context.undefined);
  context.setProp(context.global, "fetch", context.undefined);
  const extraHandles: QuickJSHandle[] = [];
  const sandboxHandle = context.newString(sandboxRoot);
  extraHandles.push(sandboxHandle);
  context.setProp(context.global, "SANDBOX_ROOT", sandboxHandle);
  if (allowNetwork) {
    const fetchHandle = installFetch(context, runtime, timeoutMs);
    if (fetchHandle) extraHandles.push(fetchHandle);
  }
  const logs: string[] = [];
  const consoleHandles = attachConsole(context, logs);

  let timedOut = false;
  const started = Date.now();
  runtime.setInterruptHandler(() => {
    if (Date.now() - started > timeoutMs) {
      timedOut = true;
      return true;
    }
    return false;
  });

  let status: "ok" | "error" | "timeout" = "ok";
  let resultText = "undefined";
  try {
    const evalResult = context.evalCode(code) as { value?: QuickJSHandle; error?: QuickJSHandle };
    if (evalResult.error) {
      status = timedOut ? "timeout" : "error";
      resultText = formatQuickJSValue(context, evalResult.error);
      disposeHandles(evalResult.error);
    } else if (evalResult.value) {
      resultText = formatQuickJSValue(context, evalResult.value);
      disposeHandles(evalResult.value);
    }
    if (status === "ok") {
      // Drain pending jobs (e.g., promises from fetch) until completion or timeout.
      while (!timedOut) {
        const jobs = runtime.executePendingJobs?.();
        if (jobs && typeof jobs === "object" && "error" in jobs && jobs.error) {
          status = "error";
          resultText = formatQuickJSValue(context, jobs.error as QuickJSHandle);
          disposeHandles(jobs.error as QuickJSHandle);
          break;
        }
        const executed = typeof jobs === "object" && jobs && "value" in jobs ? (jobs as { value?: number }).value ?? 0 : Number(jobs ?? 0);
        if (!executed || executed <= 0) break;
        if (Date.now() - started > timeoutMs) {
          timedOut = true;
          status = "timeout";
          break;
        }
      }
    }
  } catch (err) {
    status = timedOut ? "timeout" : "error";
    resultText = err instanceof Error ? err.message : String(err);
  } finally {
    disposeHandles(...consoleHandles.handles, consoleHandles.consoleObj, ...extraHandles);
    context.dispose();
    runtime.dispose();
  }

  const parts = [`status: ${status}`, `result: ${resultText}`];
  if (logs.length) {
    parts.push("console:", ...logs);
  }
  const output = truncateOutput(parts.join("\n"), maxOutputBytes);
  return { id: "run_js", output, error: status !== "ok" };
};

async function loadQuickJSModule() {
  if (!quickJsModulePromise) {
    quickJsModulePromise = getQuickJS();
  }
  return quickJsModulePromise;
}

function attachConsole(context: QuickJSContext, logs: string[]) {
  const consoleObj = context.newObject();
  const handles: QuickJSHandle[] = [];
  const make = (label: string) => {
    const fn = context.newFunction(label, (...params: QuickJSHandle[]) => {
      const rendered = params.map((p) => formatQuickJSValue(context, p)).join(" ");
      logs.push(rendered ? `${label}: ${rendered}` : label);
    });
    handles.push(fn);
    context.setProp(consoleObj, label, fn);
  };
  make("log");
  make("warn");
  make("error");
  context.setProp(context.global, "console", consoleObj);
  return { consoleObj, handles };
}

function disposeHandles(...handles: Array<QuickJSHandle | null | undefined>) {
  for (const handle of handles) {
    try {
      handle?.dispose();
    } catch {
      // ignore
    }
  }
}

function formatQuickJSValue(context: QuickJSContext, handle: QuickJSHandle) {
  const kind = context.typeof(handle);
  if (kind === "number") return String(context.getNumber(handle));
  if (kind === "string") return context.getString(handle);
  if (kind === "boolean") return String(Boolean(context.getNumber(handle)));
  if (kind === "undefined") return "undefined";
  if (kind === "object") {
    const dumped = context.dump(handle);
    if (dumped === null) return "null";
    try {
      return JSON.stringify(dumped);
    } catch {
      return String(dumped);
    }
  }
  const dumped = context.dump(handle);
  return dumped === undefined ? "undefined" : String(dumped);
}

function installFetch(context: QuickJSContext, runtime: QuickJSRuntime, timeoutMs: number): QuickJSHandle | null {
  const hostFetch = globalThis.fetch?.bind(globalThis);
  const hasPromiseCapability = typeof (context as any).newPromiseCapability === "function";
  if (!hostFetch || !hasPromiseCapability) return null;
  const fetchFn = context.newFunction("fetch", (...params: QuickJSHandle[]) => {
    const url = params[0] ? context.dump(params[0]) : undefined;
    const init = params[1] ? context.dump(params[1]) : undefined;
    const { promise, resolve, reject } = (context as any).newPromiseCapability();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    hostFetch(url as any, { ...(init as any), signal: controller.signal })
      .then(async (resp: Response) => {
        clearTimeout(timer);
        const text = await resp.text();
        const textHandle = context.newString(text);
        resolve(textHandle);
        textHandle.dispose();
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const errHandle = context.newString(err instanceof Error ? err.message : String(err));
        reject(errHandle);
        errHandle.dispose();
      });
    disposeHandles(...params);
    return promise;
  });
  context.setProp(context.global, "fetch", fetchFn);
  return fetchFn;
}
