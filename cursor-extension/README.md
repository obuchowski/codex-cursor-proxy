# Codex Proxy Extension

Cursor/VS Code extension for starting and stopping `codex-cursor-proxy` from the current workspace.

## Prerequisites

- `codex-cursor-proxy` must be available as a shell command.
- Recommended local setup from the repo root:

```bash
cd /Users/evgeni/WebstormProjects/local/llm-proxy/codex-cursor-proxy
bun link
```

- Bun, Codex CLI auth, Cloudflare tunnel config, and `.env` requirements are the same as the main proxy package.
- The Cursor `OpenAI API Key` toggle must be enabled manually in Cursor settings. This extension does not edit Cursor settings.

If the command is not on PATH, set `codexCursorProxy.commandPath` to the absolute executable path.

## What It Runs

When enabled from a workspace, the extension runs:

```bash
codex-cursor-proxy <current-workspace-directory>
```

Argument resolution:

- The workspace directory is resolved from `vscode.workspace.workspaceFolders[0].uri.fsPath`.
- The spawned process uses that same directory as `cwd`.
- The workspace path is passed as the first positional argument, which the proxy resolves as `projectCwd`.
- If no folder/workspace is open, the extension shows an error and does not start the proxy.

Only one proxy process is tracked by the extension at a time.

## Install For Personal Use

Build the VSIX:

```bash
cd /Users/evgeni/WebstormProjects/local/llm-proxy/codex-cursor-proxy/cursor-extension
npm install
npx @vscode/vsce package
```

Install it in Cursor:

1. Open Command Palette.
2. Run `Extensions: Install from VSIX...`.
3. Select the generated `.vsix` file from `cursor-extension/`.
4. Run `Developer: Reload Window`.

## Usage

- Use the `Codex Proxy` status-bar item in the bottom right.
- Or run commands from Command Palette:
  - `Codex Proxy: Toggle Codex Proxy`
  - `Codex Proxy: Start Codex Proxy`
  - `Codex Proxy: Stop Codex Proxy`
- Logs appear in the `Codex Proxy` output channel.

The extension also contributes a top-right editor title action, but Cursor may hide third-party editor-title actions in some layouts. The status-bar item is the reliable control.

## Settings

`codexCursorProxy.commandPath` (default: `codex-cursor-proxy`)
- Command used to start the proxy binary.

`codexCursorProxy.shutdownTimeoutMs` (default: `2000`)
- Grace period before sending force kill to the proxy process during stop.
