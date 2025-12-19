# Steward

> Helping you with smaller tasks while Copilot handles the big stuff.

Steward is a `bun`-based command-line tool that provides a harness for running large language models (LLMs) with a predefined set of tools.

It is inspired by GitHub Copilot and aims to be an informal test suite for small LLMs (which I have been shoehorning into ARM devices for years now) to evaluate their ability to perform basic scripting tasks using tools like file reading, searching, executing commands, applying patches, managing todo lists, and fetching web content.

It is designed to be run against OpenAI-compatible models, but is developed using Azure OpenAI endpoints and also includes an "echo" provider for testing purposes.

It is also, scarily, already able to reproduce itself (`make inception`).

## Quick start

1. Install dependencies:

   ```bash
   bun install
   ```

2. Run with the echo provider:

   ```bash
   bun run src/cli.ts "List files in the workspace"
   ```

3. Run with OpenAI (needs `STEWARD_OPENAI_API_KEY` or `OPENAI_API_KEY`):

   ```bash
   STEWARD_OPENAI_API_KEY=sk-... bun run src/cli.ts "Read README and summarize" --provider openai --model gpt-4o-mini
   ```

4. Run with Azure OpenAI:

   ```bash
   STEWARD_AZURE_OPENAI_ENDPOINT=https://your-endpoint \
   STEWARD_AZURE_OPENAI_KEY=... \
   STEWARD_AZURE_OPENAI_DEPLOYMENT=your-deployment \
   bun run src/cli.ts "Read README and summarize" --provider azure --model gpt-4o-mini
   ```

## CLI options

- `--provider <echo|openai|azure>`: choose the LLM backend (default: echo).
- `--model <name>`: model identifier for the provider (default: GPT-4o-mini).
- `--max-steps <n>`: limit the number of tool/LLM turns (default: 16).
- `--log-json <file>`: write JSONL logs (default: .steward-log.jsonl or STEWARD_LOG_JSON).
- `--no-log-json`: disable JSONL logging.
- `--quiet`: suppress human-readable logs to stdout.
- `--pretty`: render human-readable logs with colored boxes.
- `--system <file>`: load a custom system prompt from a file.

Pre-baked Copilot-style system prompt: prompts/copilot-system.txt.
Starter user prompts: see [prompts/starters](prompts/starters.md).

## Tools (Copilot-aligned names)

- **read_file**: read a file (optional line range), supports maxLines/maxBytes with truncation note; defaults can be set via `STEWARD_READ_MAX_LINES` / `STEWARD_READ_MAX_BYTES`.
- **grep_search**: search for a pattern in workspace files (recursive scan, capped results, include/exclude filters, includeGlob/excludeGlob); supports contextLines or asymmetric before/after context, caseSensitive/smartCase, fixedString, wordMatch, includeHidden/includeBinary, optional context labels/separators, and maxFileBytes guard; default cap via `STEWARD_SEARCH_MAX_RESULTS` and default file cap via `STEWARD_SEARCH_MAX_FILE_BYTES`.
- Extras: per-file headings and match counts via `withHeadings` / `withCounts`; context separators via `withContextSeparators`.
- **create_file**: create or overwrite a file with content.
- **list_dir**: list directory entries (skips node_modules/.git unless includeIgnored is true).
- **execute**: run a shell command with optional cwd/env/timeout/background/stream/maxOutputBytes using Bun's process API (requires `STEWARD_ALLOW_EXECUTE=1`). Respects allow/deny lists via `STEWARD_EXEC_ALLOW` / `STEWARD_EXEC_DENY` (comma-separated), optional default timeout via `STEWARD_EXEC_TIMEOUT_MS`, default output cap via `STEWARD_EXEC_MAX_OUTPUT_BYTES`, and audit logging to `.steward-exec-audit.log` (disable with `STEWARD_EXEC_AUDIT=0`).
- **apply_patch**: apply a unified diff patch to a file; supports `dryRun` to validate without writing; also accepts `patches` array for multi-file batches (all-or-nothing validation before write).
- **manage_todo**: add/list/complete tasks stored in `.steward-todo.json`; supports statuses (not-started, in-progress, blocked, done) and `set_status`.
- **web_fetch**: fetch a URL (response truncated to protect output size), optional textOnly strip with content-type note; default size cap via `STEWARD_WEB_MAX_BYTES`.
- **git_status**: short git status (with branch) for the workspace or a subpath.
- **git_diff**: git diff (optionally staged/ref/path) with output truncation.
- **git_commit**: commit staged changes (optionally with --all) in the workspace or a subpath.
- **git_stash**: manage git stash (save/pop/list) for the workspace or a subpath.
- **workspace_summary**: lightweight summary of package.json (if any) and top-level dirs/files (ignores .git/node_modules).

LLM providers:

- OpenAI-compatible: `--provider openai` with `STEWARD_OPENAI_API_KEY` (or `OPENAI_API_KEY`) and optional `STEWARD_OPENAI_BASE_URL` for compatible hosts.
- Azure OpenAI: `--provider azure` with `STEWARD_AZURE_OPENAI_ENDPOINT`, `STEWARD_AZURE_OPENAI_KEY`, `STEWARD_AZURE_OPENAI_DEPLOYMENT`, optional `STEWARD_AZURE_OPENAI_API_VERSION` (default 2024-10-01-preview).

Notes:

- Paths are constrained to the current working directory.
- The steward stops after `--max-steps` even if the model keeps issuing tool calls.
- For OpenAI, the steward uses Chat Completions with function tools.

## Examples (Copilot-style flows)

- Read + search + patch a file:

  ```bash
  bun run src/cli.ts "Inspect src/tools.ts and add a short comment above grep_search explaining context options. Use read_file, then grep_search, then apply_patch." --provider echo
  ```

- Find an error location with search context and headings:

  ```bash
  bun run src/cli.ts "Search for 'TODO' in src with headings, then read the file sections to summarize outstanding work." --provider echo
  ```

- Run tests with execute (requires STEWARD_ALLOW_EXECUTE=1):
  ```bash
  STEWARD_ALLOW_EXECUTE=1 bun run src/cli.ts "Run bun test with dots reporter from the repo root and report the summary." --provider echo
  ```

## Roadmap

- [ ] Add basic MCP support (testing against [`umcp`](https://github.com/rcarmo/umcp))
- [ ] Add Anthropic-like skills
