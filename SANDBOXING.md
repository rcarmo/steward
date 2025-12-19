# Sandbox Model and Limitations

This document describes how Steward sandboxes tool execution today, the known limitations, and operational recommendations. It applies to the current tool set (only `run_js` for code execution).

## Overview

- Isolation is library-level only. There is **no OS-level sandbox** (no namespaces, no seccomp, no container boundary). Untrusted code runs inside the Steward process.
- Two main controls are used: timeouts/interrupts and API surface reduction. Memory is not capped.

## QuickJS (`run_js`)

- **Runtime**: QuickJS context per invocation; runtime disposed after each call.
- **Timeouts**: Interrupt handler checks wall-clock time against `timeoutMs` (default `STEWARD_JS_TIMEOUT_MS`). Busy loops are interrupted; long async work can still run until the interrupt fires.
- **Host surface stripping**: `process`, `require`, `fs`, and `fetch` are removed from the global object by default.
- **Console capture**: `console.log/warn/error` are captured and returned in the tool output; no other host I/O is exposed.
- **Network**: Disabled by default. If `allowNetwork` is true, a minimal `fetch` is injected using the host’s `globalThis.fetch` with the same timeout and a pending-job drain. This exposes outbound HTTP(S) to whatever the host allows.
- **Filesystem**: No direct host FS binding is exposed. There is no virtual FS; code cannot read workspace files via provided globals. `SANDBOX_ROOT` is set for informational purposes only and is **not an enforcement mechanism**.
- **Async jobs**: After execution, pending jobs are drained (`executePendingJobs`) until they settle or the timeout elapses.

### QuickJS Limitations & Risks

- **Process co-residency**: Malicious code can attempt DoS via CPU or memory; only a time-based interrupt exists. Memory is unbounded and shares the host heap.
- **Network trust**: Enabling `allowNetwork` hands out host `fetch`; responses are not sandboxed beyond QuickJS memory.
- **No module sandbox**: Users can define arbitrary globals and functions; there is no import filter because module loading is absent, not restricted.
- **No resource accounting**: No per-run CPU or memory quotas beyond the timeout guard.
- **Side-channel/host reachability**: If other host globals are injected elsewhere, code could reach them. Keep the global surface minimal.

## Operational Guidance

- Keep `allowNetwork` off unless required; when on, assume untrusted code can reach the internet.
- Set strict `timeoutMs` per call; prefer small defaults for untrusted inputs.
- Run Steward itself inside an OS/container sandbox when handling untrusted code (namespaces, cgroups, seccomp, or a dedicated VM) to mitigate DoS and memory risks.
- Treat tool output as untrusted; do not render it as HTML without sanitization.

## Gaps / Future Hardening

- Add real filesystem policies (e.g., an in-memory FS with optional seeding, and explicit denies for path escapes).
- Add memory limits or watchdogs for QuickJS runtimes (currently none).
- Consider per-request process isolation (worker subprocess) for stronger blast-radius reduction.
- Optionally remove the network bridge entirely, or proxy it with allow/deny lists and response size caps.
