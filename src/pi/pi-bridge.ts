import { getModel } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import { createLogger } from "../helpers/log";
import { asNonEmptyString, isRecord } from "../helpers/guards";
import { readCodexAuthFile } from "../helpers/codex-auth-file";
import { runWithToolLoop } from "./tool-loop";
import { buildPiTools, piToolsAsCodexDefs } from "./pi-tools";

function getAccessToken(): string {
  const auth = readCodexAuthFile();
  const tokens = auth.tokens;
  if (!isRecord(tokens)) return "";
  return asNonEmptyString(tokens.access_token) ?? "";
}

function keepCursorTool(tool: unknown): boolean {
  return !tool || typeof tool !== "object" || (tool as { name?: unknown }).name !== "ApplyPatch";
}

function toolName(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "(invalid)";
  const obj = tool as { name?: unknown; function?: { name?: unknown } };
  const name = obj.name ?? obj.function?.name;
  return typeof name === "string" ? name : "(unnamed)";
}

export async function runCodexViaPi(opts: {
  parsed: Record<string, unknown>;
  originator: string;
  projectCwd: string;
  requestId: string;
  debug: boolean;
}): Promise<Response> {
  const { parsed, originator, projectCwd, requestId, debug } = opts;
  const logger = createLogger(debug);

  const body = parsed;
  const modelId = (body.model as string) ?? "gpt-5.4";

  const apiKey = getAccessToken();
  if (!apiKey) {
    throw new Error("No access token. Run `codex` to authenticate.");
  }

  const model = getModel("openai-codex", modelId as never) as Model<"openai-codex-responses"> | undefined;
  if (!model) {
    return Response.json({ error: `Unknown openai-codex model: ${modelId}` }, { status: 400 });
  }

  const piEntries = buildPiTools(projectCwd);
  const piDefs = piToolsAsCodexDefs(piEntries);
  body.tools = [...(Array.isArray(body.tools) ? body.tools.filter(keepCursorTool) : []), ...piDefs];

  if (debug && Array.isArray(body.tools)) {
    logger.debug(`[${requestId}] upstream_tools ${body.tools.map(toolName).join(",")}`);
  }

  const codexPayload = { ...body, model: model.id };

  return runWithToolLoop({
    body: codexPayload,
    model,
    apiKey,
    originator,
    displayModel: modelId,
    piTools: piEntries,
    requestId,
    projectCwd,
    debug,
  });
}
