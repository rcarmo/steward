#!/usr/bin/env bun
import { promises as fs } from "node:fs";
import path from "node:path";
import { runSteward } from "./runner.ts";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const {
    prompt,
    provider,
    model,
    maxSteps,
    systemPrompt,
    logJsonPath,
    enableHumanLogs,
    enableFileLogs,
    prettyLogs,
    timeoutMs,
    retries,
  } = await parseArgs(args);

  await runSteward({
    prompt,
    provider,
    model,
    maxSteps,
    systemPrompt,
    logJsonPath,
    enableHumanLogs,
    enableFileLogs,
    prettyLogs,
    requestTimeoutMs: timeoutMs,
    retries,
  });
}

async function parseArgs(argv: string[]) {
  let promptParts: string[] = [];
  let provider: string | undefined;
  let model: string | undefined;
  let maxSteps: number | undefined;
  let timeoutMs: number | undefined;
  let retries: number | undefined;
  let systemPrompt: string | undefined;
  let logJsonPath: string | null | undefined;
  let enableHumanLogs = true;
  let enableFileLogs = true;
  let prettyLogs = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--provider") {
      provider = argv[++i];
      continue;
    }
    if (token === "--model") {
      model = argv[++i];
      continue;
    }
    if (token === "--max-steps") {
      const raw = argv[++i];
      maxSteps = Number(raw);
      continue;
    }
    if (token === "--timeout-ms") {
      const raw = argv[++i];
      timeoutMs = Number(raw);
      continue;
    }
    if (token === "--retries") {
      const raw = argv[++i];
      retries = Number(raw);
      continue;
    }
    if (token === "--log-json") {
      logJsonPath = argv[++i];
      continue;
    }
    if (token === "--no-log-json") {
      enableFileLogs = false;
      continue;
    }
    if (token === "--quiet") {
      enableHumanLogs = false;
      continue;
    }
    if (token === "--pretty") {
      prettyLogs = true;
      continue;
    }
    if (token === "--system") {
      const file = argv[++i];
      const abs = path.resolve(process.cwd(), file);
      systemPrompt = await fs.readFile(abs, "utf8");
      continue;
    }
    promptParts.push(token);
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    throw new Error("Prompt is required");
  }

  if (maxSteps !== undefined && !Number.isFinite(maxSteps)) throw new Error("--max-steps must be a number");
  if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) throw new Error("--timeout-ms must be a number");
  if (retries !== undefined && !Number.isFinite(retries)) throw new Error("--retries must be a number");

  return {
    prompt,
    provider,
    model,
    maxSteps,
    systemPrompt,
    logJsonPath,
    enableHumanLogs,
    enableFileLogs,
    prettyLogs,
    timeoutMs,
    retries,
  };
}

function printHelp() {
  console.log(`steward <prompt> [options]
Options:
  --provider <echo|openai|azure>   LLM provider (default: echo)
  --model <name>             Model name (default: gpt-4o-mini)
  --max-steps <n>            Limit tool/LLM turns (default: 16)
  --timeout-ms <n>           Per-LLM-call timeout in milliseconds
  --retries <n>              Retry failed/timeout LLM calls (default: 0)
  --log-json <file>          Write JSON logs to file (default: .steward-log.jsonl)
  --no-log-json              Disable JSONL logging
  --quiet                    Suppress human-readable logs to stdout
  --pretty                   Enable pretty boxed/color human logs
  --system <file>            Load system prompt from file
  --help                     Show this help
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
