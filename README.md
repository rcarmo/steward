# Harness

Bun-based CLI harness that mimics a subset of the GitHub Copilot extension by running an LLM with a fixed toolset (edit, execute, read, search, todo, web).

## Quick start

1. Install dependencies:

   ```bash
   bun install
   ```

2. Run with the echo provider:

   ```bash
   bun run src/cli.ts "List files in the workspace"
   ```

3. Run with OpenAI (needs `OPENAI_API_KEY`):

   ```bash
   OPENAI_API_KEY=sk-... bun run src/cli.ts "Read README and summarize" --provider openai --model gpt-4o-mini
   ```

## CLI options

- `--provider <echo|openai>`: choose the LLM backend (default: echo).
- `--model <name>`: model identifier for the provider (default: GPT-4o-mini).
- `--max-steps <n>`: limit the number of tool/LLM turns (default: 8).
- `--system <file>`: load a custom system prompt from a file.

Pre-baked Copilot-style system prompt: prompts/copilot-system.txt.
Starter user prompts: see [prompts/starters](prompts/starters.md).

## Tools (Copilot-aligned names)

- **read_file**: read a file (optional line range), supports maxLines/maxBytes with truncation note.
- **grep_search**: search for a pattern in workspace files (recursive scan, capped results, include/exclude filters, includeGlob/excludeGlob).
- **create_file**: create or overwrite a file with content.
- **list_dir**: list directory entries (skips node_modules/.git unless includeIgnored is true).
- **execute**: run a shell command with optional cwd/env/timeout using Bun's process API (requires `HARNESS_ALLOW_EXECUTE=1`).
- **apply_patch**: apply a unified diff patch to a file; supports `dryRun` to validate without writing.
- **manage_todo**: add/list/complete tasks stored in `.harness-todo.json`; supports statuses (not-started, in-progress, blocked, done) and `set_status`.
- **web_fetch**: fetch a URL (response truncated to protect output size), optional textOnly strip with content-type note.

Notes:

- Paths are constrained to the current working directory.
- The harness stops after `--max-steps` even if the model keeps issuing tool calls.
- For OpenAI, the harness uses Chat Completions with function tools.
