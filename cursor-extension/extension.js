const vscode = require("vscode");
const { spawn } = require("node:child_process");

const TOGGLE_COMMAND_ID = "codexCursorProxy.toggle";
const START_COMMAND_ID = "codexCursorProxy.start";
const STOP_COMMAND_ID = "codexCursorProxy.stop";
const CONTEXT_RUNNING_KEY = "codexCursorProxy.running";

let outputChannel;
let statusBarItem;
let runningProxy;

function getConfig() {
  return vscode.workspace.getConfiguration("codexCursorProxy");
}

function getWorkspacePath() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a Cursor workspace/folder first.");
  }
  return folder.uri.fsPath;
}

function updateStatus(isRunning) {
  vscode.commands.executeCommand("setContext", CONTEXT_RUNNING_KEY, isRunning);

  statusBarItem.text = isRunning ? "$(debug-stop) Codex Proxy" : "$(plug) Codex Proxy";
  statusBarItem.tooltip = isRunning ? "Stop Codex Proxy" : "Start Codex Proxy";
  statusBarItem.command = TOGGLE_COMMAND_ID;
  statusBarItem.show();
}

function appendOutput(child) {
  child.stdout?.on("data", (chunk) => outputChannel.append(chunk.toString()));
  child.stderr?.on("data", (chunk) => outputChannel.append(chunk.toString()));
}

function stopChild(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    child.once("exit", finish);

    try {
      if (!child.kill("SIGTERM")) {
        finish();
        return;
      }
    } catch {
      finish();
      return;
    }

    const timeoutMs = Math.max(250, Number(getConfig().get("shutdownTimeoutMs", 2000)) || 2000);
    setTimeout(() => {
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch {
          finish();
        }
      }
      setTimeout(finish, 500);
    }, timeoutMs);
  });
}

async function startProxy() {
  if (runningProxy) {
    vscode.window.showInformationMessage("Codex Proxy is already running.");
    return;
  }

  const workspacePath = getWorkspacePath();
  const commandPath = getConfig().get("commandPath", "codex-cursor-proxy");
  const child = spawn(commandPath, [workspacePath], {
    cwd: workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  runningProxy = child;
  appendOutput(child);
  updateStatus(true);
  outputChannel.show(true);
  outputChannel.appendLine(`[proxy] started (pid=${child.pid}) for ${workspacePath}`);

  child.once("exit", () => {
    if (runningProxy !== child) return;
    outputChannel.appendLine("[proxy] exited");
    runningProxy = undefined;
    updateStatus(false);
  });
}

async function stopProxy() {
  if (!runningProxy) {
    updateStatus(false);
    return;
  }

  const child = runningProxy;
  runningProxy = undefined;
  await stopChild(child);
  updateStatus(false);
  outputChannel.appendLine("[proxy] stopped");
}

async function toggleProxy() {
  if (runningProxy) {
    await stopProxy();
  } else {
    await startProxy();
  }
}

function registerCommand(context, id, handler) {
  context.subscriptions.push(
    vscode.commands.registerCommand(id, async () => {
      try {
        await handler();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Codex Proxy: ${message}`);
        outputChannel?.appendLine(`[error] ${message}`);
      }
    }),
  );
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Codex Proxy");
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = "Codex Proxy";

  context.subscriptions.push(outputChannel, statusBarItem);
  updateStatus(false);

  registerCommand(context, TOGGLE_COMMAND_ID, toggleProxy);
  registerCommand(context, START_COMMAND_ID, startProxy);
  registerCommand(context, STOP_COMMAND_ID, stopProxy);
}

async function deactivate() {
  await stopProxy();
}

module.exports = {
  activate,
  deactivate,
};
