import { asNonEmptyString, isRecord } from "./guards";

const DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";
export const ALLOWED_PARAMS = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "store",
  "include",
  "stream",
  "reasoning",
  "temperature",
  "top_p",
  "max_output_tokens",
  "truncation",
  "text",
  "parallel_tool_calls",
  "previous_response_id",
]);

function normalizeTool(tool: unknown): Record<string, unknown> | null {
  if (!isRecord(tool)) return null;
  const copied = { ...tool };

  const typ = ((copied.type as string | undefined) ?? "function").toLowerCase();
  if (typ === "custom" && isRecord(copied.custom)) {
    Object.assign(copied, copied.custom);
    delete copied.custom;
  }

  if (isRecord(copied.function)) {
    const fn = copied.function;
    if (!copied.name && isNonEmptyString(fn.name)) copied.name = fn.name;
    if (!copied.description && isNonEmptyString(fn.description)) copied.description = fn.description;
    if (copied.parameters == null && isRecord(fn.parameters)) copied.parameters = fn.parameters;
    delete copied.function;
  }

  copied.type = "function";
  if (!asNonEmptyString(copied.name)) return null;
  copied.name = copied.name as string;

  if (copied.parameters == null) copied.parameters = {};
  if (!asNonEmptyString(copied.description)) copied.description = "";

  return copied;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const nextBody = { ...body };

  if (Array.isArray(nextBody.input)) {
    nextBody.input = [...nextBody.input];
  }

  if (!nextBody.input && Array.isArray(nextBody.messages) && nextBody.messages.length > 0) {
    nextBody.input = [...(nextBody.messages as unknown[])];
    delete nextBody.messages;
  } else if (typeof nextBody.input === "string") {
    nextBody.input = [{ role: "user", content: nextBody.input }];
  }

  if (Array.isArray(nextBody.tools)) {
    const cleaned = (nextBody.tools as unknown[]).map(normalizeTool).filter(Boolean) as Record<string, unknown>[];
    if (cleaned.length > 0) {
      nextBody.tools = cleaned;
    } else {
      delete nextBody.tools;
      if (nextBody.tool_choice !== "none") nextBody.tool_choice = "none";
    }
  }

  if (!nextBody.instructions && Array.isArray(nextBody.input)) {
    const idx = (nextBody.input as { role?: string }[]).findIndex((m) => m?.role === "system");
    if (idx !== -1) {
      const systemMessage = (nextBody.input as { content?: unknown }[])[idx];
      nextBody.instructions = systemMessage?.content;
      nextBody.input.splice(idx, 1);
    }
  }

  if (!nextBody.instructions) {
    nextBody.instructions = DEFAULT_INSTRUCTIONS;
  }

  delete nextBody.user;
  delete nextBody.metadata;
  delete nextBody.prompt_cache_retention;
  delete nextBody.stream_options;
  delete nextBody.messages;

  nextBody.store = false;
  nextBody.stream = true;

  for (const key of Object.keys(nextBody)) {
    if (!ALLOWED_PARAMS.has(key)) delete nextBody[key];
  }

  return nextBody;
}
