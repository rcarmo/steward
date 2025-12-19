#!/usr/bin/env bun
import { promises as fs } from "node:fs";
import path from "node:path";
import { runHarness } from "./runner.ts";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const { prompt, provider, model, maxSteps, systemPrompt } = await parseArgs(args);
  await runHarness({ prompt, provider, model, maxSteps, systemPrompt });
}

async function parseArgs(argv: string[]) {
  let promptParts: string[] = [];
  let provider: string | undefined;
  let model: string | undefined;
  let maxSteps: number | undefined;
  let systemPrompt: string | undefined;

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

  return { prompt, provider, model, maxSteps, systemPrompt };
}

function printHelp() {
  console.log(`harness <prompt> [options]
Options:
  --provider <echo|openai>   LLM provider (default: echo)
  --model <name>             Model name (default: gpt-4o-mini)
  --max-steps <n>            Limit tool/LLM turns (default: 8)
  --system <file>            Load system prompt from file
  --help                     Show this help
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
