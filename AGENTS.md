---
description: Runtime guidance for codex-cursor-proxy
---

## Modes

- `codex-cursor-proxy`: minimal proxy
- `codex-cursor-proxy-pi`: PI mode with local file tools

## Commands

### Minimal

```bash
bun run start
bun run start -- --debug
bunx codex-cursor-proxy
bunx codex-cursor-proxy -- --debug
```

### PI

```bash
bun run start:pi
bun run start:pi -- --debug
bunx codex-cursor-proxy-pi [projectDir]
bunx codex-cursor-proxy-pi [projectDir] --debug
```

## Environment

- `API_KEY` is required.
- `CLOUDFLARE_TUNNEL_NAME` is optional.
- `.env` is loaded from the package root.
- Default port is `3000`.

## Logging Contract

Always-on logs:

- startup line
- tunnel startup and tunnel URL
- request line for each `POST /chat/completions`
- auth, parsing, and upstream errors

Debug logs with `--debug`:

- request input tail summary
- PI tool-loop diagnostics

Request log shape:

```text
[proxy] [<requestId>] POST /chat/completions model=<model> input_items=<count>
```

## PI Runtime Rules

- The first positional argument sets the working directory for PI tools.
- If omitted, PI mode uses `process.cwd()`.
- PI mode exposes `fileEdit` and `fileWrite` to the model.
- PI file tools execute inside the proxy.
- After a PI tool result, the proxy appends `function_call` and `function_call_output` and continues the same Codex turn.
- Paths shown in PI status messages are relative to the PI working directory.

## Source Layout

- `src/minimal`: minimal proxy flow
- `src/pi`: PI bridge and tool loop
- `src/helpers`: shared runtime helpers
