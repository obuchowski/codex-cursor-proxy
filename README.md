# codex-cursor-proxy

Use your ChatGPT Codex session from clients like Cursor through an OpenAI-compatible `POST /chat/completions` proxy.

It ships in two modes:

- `codex-cursor-proxy`: PI mode with local file-edit tools
- `codex-cursor-proxy-minimal`: minimal proxy

## Modes

### PI

This is the default mode.

Use it when you want the model to edit local files through the proxy.

### Minimal

Use this when you want a clean Codex-to-Cursor bridge without local editing tools.

PI mode exposes:

- `fileEdit`
- `fileWrite`

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Codex CLI](https://github.com/openai/codex) authenticated
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) on `PATH`

### Environment

Create `.env` in the package root:

```bash
API_KEY=your-local-proxy-key
CLOUDFLARE_TUNNEL_NAME=
```

The proxy always loads `.env` from the package root, so it behaves the same no matter where you launch it from.

### Run PI Mode

```bash
bun run start
bun run start -- --debug
```

Or through the package entrypoint:

```bash
bunx codex-cursor-proxy
bunx codex-cursor-proxy /path/to/project
bunx codex-cursor-proxy /path/to/project --debug
```

If you omit the project path in PI mode, it uses `process.cwd()`.

That means you can launch it from any directory and it will use that directory as the local tool root.

### Run Minimal Mode

```bash
bun run start:minimal
bun run start:minimal -- --debug
```

Or through the package entrypoint:

```bash
bunx codex-cursor-proxy-minimal
bunx codex-cursor-proxy-minimal -- --debug
```

## Cursor Setup

1. Start the proxy.
2. Copy the Cloudflare tunnel URL printed in the logs.
3. In Cursor, set:
   - Base URL: the tunnel URL
   - API Key: the same `API_KEY` from `.env`
4. Choose a supported Codex model such as `gpt-5.4`.

## PI Mode

PI mode adds local file editing on top of the normal proxy flow.

- The first positional argument sets the project directory for local tools.
- File paths shown in chat are relative to that directory.
- File tool calls are executed inside the proxy before the Codex turn continues.

Use PI mode when you want the model to make local code changes. It is also the easiest mode to run from any directory: launch `codex-cursor-proxy` there and it will use that directory by default.

Use minimal mode when you only need the upstream bridge.

## Logging

Always-on logs include:

- startup
- tunnel status
- one request line per `POST /chat/completions`

`--debug` adds more detail, including request input summaries. In PI mode it also logs tool-loop activity.

## Project Layout

- `src/minimal`: minimal proxy entrypoint and upstream bridge
- `src/pi`: PI entrypoint and tool-loop logic
- `src/helpers`: shared runtime helpers

## License

MIT
