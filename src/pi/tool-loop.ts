import type { AssistantMessage, Model, ToolCall } from "@earendil-works/pi-ai";
import { isAbsolute, relative, sep } from "node:path";
import { createLogger } from "../helpers/log";
import { chatChunk, chatFinalChunks } from "../helpers/sse-chunks";
import { inputItemCount, inputTailSummary, previewJson } from "../helpers/request-summary";
import { streamCodexOnce } from "./codex-stream";
import { executePiTool, findPiTool, getPiToolLabel, isPiToolName, type PiToolEntry } from "./pi-tools";

const MAX_TOOL_TURNS = 8;
const PI_TOOL_TIMEOUT_MS = 30_000;

function relativeDisplayPath(projectCwd: string, filePath: string): string {
  const path = isAbsolute(filePath) ? relative(projectCwd, filePath) || "." : filePath;
  return sep === "/" ? path : path.split(sep).join("/");
}

function diffLines(text: string | undefined, prefix: "-" | "+"): string[] {
  if (text == null) return [];
  const ls = text.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls.map((l) => `${prefix}${l}`);
}

function piDiffBlock(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  if (Array.isArray(obj.edits)) {
    const lines: string[] = [];
    for (const edit of obj.edits) {
      if (!edit || typeof edit !== "object") continue;
      const e = edit as { oldText?: string; newText?: string };
      lines.push(...diffLines(e.oldText, "-"), ...diffLines(e.newText, "+"));
    }
    return lines.length ? `\`\`\`diff\n${lines.join("\n")}\n\`\`\`` : "";
  }
  if (typeof obj.content === "string") {
    return `\`\`\`diff\n${diffLines(obj.content, "+").join("\n")}\n\`\`\``;
  }
  return "";
}

function piStatusLine(name: string, args: unknown, output: string, projectCwd: string): string {
  const path = args && typeof args === "object" ? (args as { path?: unknown }).path : undefined;
  const target = typeof path === "string" ? relativeDisplayPath(projectCwd, path) : "(no path)";
  const label = getPiToolLabel(name);
  const diff = piDiffBlock(args);
  const errorNote = output.startsWith("error:") ? `\n> error: ${output.slice(6).trim()}` : "";
  return `\n\n**${label}** \`${target}\`\n${diff}${errorNote}\n\n`;
}

function toCodexFunctionCallId(piToolCallId: string): string {
  const raw = piToolCallId.trim();
  if (raw.startsWith("fc")) return raw;
  return raw.startsWith("call_") ? `fc_${raw.slice(5)}` : `fc_${raw}`;
}

function toCodexCallIds(piToolCallId: string): { id: string; callId: string } {
  const [callIdRaw, itemIdRaw] = piToolCallId.split("|");
  const callId = (callIdRaw || piToolCallId).trim();
  return { id: toCodexFunctionCallId((itemIdRaw || callId).trim()), callId };
}

function toolCallsFromMessage(msg: AssistantMessage): ToolCall[] {
  return msg.content.filter((c): c is ToolCall => c.type === "toolCall");
}

function encodeToolCallDeltas(
  tcs: ToolCall[],
  chatId: string,
  created: number,
  displayModel: string,
  encoder: TextEncoder,
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let index = 0;

  for (const tc of tcs) {
    const openaiId = tc.id.includes("|") ? tc.id.split("|")[0]! : tc.id;
    const argsStr = JSON.stringify(tc.arguments ?? {});
    chunks.push(
      encoder.encode(
        chatChunk(chatId, created, displayModel, {
          content: null,
          tool_calls: [{ index, id: openaiId, type: "function", function: { name: tc.name, arguments: "" } }],
        }),
      ),
    );
    chunks.push(
      encoder.encode(
        chatChunk(chatId, created, displayModel, {
          content: null,
          tool_calls: [{ index, function: { arguments: argsStr } }],
        }),
      ),
    );
    index++;
  }

  return chunks;
}

function emitFinal(
  encoder: TextEncoder,
  msg: AssistantMessage,
  chatId: string,
  created: number,
  displayModel: string,
  finish: "stop" | "tool_calls",
): Uint8Array[] {
  const outModel = msg.responseModel ?? msg.model ?? displayModel;
  const u = msg.usage;
  const usage = u
    ? {
      prompt_tokens: u.input + u.cacheRead,
      completion_tokens: u.output,
      total_tokens: u.totalTokens,
    }
    : undefined;

  return chatFinalChunks(chatId, created, outModel, finish, usage).map((line) => encoder.encode(line));
}

export function runWithToolLoop(opts: {
  body: Record<string, unknown>;
  model: Model<"openai-codex-responses">;
  apiKey: string;
  originator: string;
  displayModel: string;
  piTools: PiToolEntry[];
  requestId: string;
  projectCwd: string;
  debug: boolean;
}): Response {
  const { body, model, apiKey, originator, displayModel, piTools, requestId, projectCwd, debug } = opts;
  const logger = createLogger(debug);

  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  let chatId = "chatcmpl-" + crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentAssistantRole = false;
      const log = (message: string) => logger.debug(`[${requestId}] ${message}`);
      const ensureRole = () => {
        if (!sentAssistantRole) {
          controller.enqueue(encoder.encode(chatChunk(chatId, created, displayModel, { role: "assistant" })));
          sentAssistantRole = true;
        }
      };

      try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          log(`upstream turn=${turn} input_len=${inputItemCount(body)} input_tail=${inputTailSummary(body)}`);
          const source = streamCodexOnce(body, model, apiKey, originator);

          for await (const ev of source) {
            // Ignore pi-ai toolcall_* deltas here: forwarding them mid-stream can make Cursor abort SSE.
            // Instead, handle tool calls after a full model turn completes.
            if (ev.type === "text_delta" && ev.delta) {
              ensureRole();
              controller.enqueue(encoder.encode(chatChunk(chatId, created, displayModel, { content: ev.delta })));
              continue;
            }

            if (ev.type === "error") {
              log(`upstream_error turn=${turn} message=${previewJson(ev.error.errorMessage ?? ev.error)}`);
              controller.error(new Error(ev.error.errorMessage ?? "upstream stream error"));
              return;
            }

            if (ev.type === "done") {
              const msg = ev.message;
              if (msg.responseId) chatId = msg.responseId;

              const allTc = toolCallsFromMessage(msg);
              const piList = allTc.filter((tc) => isPiToolName(tc.name));
              const hasNonPi = allTc.some((tc) => !isPiToolName(tc.name));
              if (allTc.length > 0) {
                log(
                  `done turn=${turn} response_id=${msg.responseId || "n/a"} total_tools=${allTc.length} pi_tools=${piList.length} non_pi_tools=${allTc.length - piList.length} names=${allTc.map((tc) => tc.name).join(",")}`,
                );
              }

              if (piList.length > 0) {
                const ac = new AbortController();

                for (const tc of piList) {
                  const entry = findPiTool(piTools, tc.name);
                  const { id: itemId, callId } = toCodexCallIds(tc.id);
                  log(`executing ${tc.name} id=${itemId} call_id=${callId} args=${previewJson(tc.arguments, 2000)} turn=${turn}`);

                  let output: string;
                  if (!entry) {
                    output = `error: unknown pi tool ${tc.name}`;
                  } else {
                    try {
                      output = await executePiTool(entry, callId, tc.arguments, projectCwd, ac.signal, PI_TOOL_TIMEOUT_MS);
                      log(`success ${tc.name} id=${itemId} call_id=${callId} output=${previewJson(output, 2000)}`);
                    } catch (e) {
                      output = `error: ${e instanceof Error ? e.message : String(e)}`;
                      log(`failed ${tc.name} id=${itemId} call_id=${callId} error=${previewJson(output, 2000)}`);
                    }
                  }

                  if (!Array.isArray(body.input)) body.input = [];
                  (body.input as unknown[]).push({
                    type: "function_call",
                    id: itemId,
                    call_id: callId,
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments ?? {}),
                  });
                  (body.input as unknown[]).push({
                    type: "function_call_output",
                    call_id: callId,
                    output,
                  });

                  ensureRole();
                  controller.enqueue(
                    encoder.encode(chatChunk(chatId, created, displayModel, {
                      content: piStatusLine(tc.name, tc.arguments, output, projectCwd),
                    })),
                  );

                  log(
                    `appended function_call/function_call_output for ${tc.name} id=${itemId} call_id=${callId} body_input_len=${(body.input as unknown[]).length}`,
                  );
                }

                log(`continuing_after_pi turn=${turn} next_input_tail=${inputTailSummary(body)}`);

                if (hasNonPi) {
                  const nonPi = toolCallsFromMessage(msg).filter((tc) => !isPiToolName(tc.name));
                  log(`defer_non_pi_until_after_pi_result names=${nonPi.map((tc) => tc.name).join(",")}`);
                }
                break;
              }

              if (hasNonPi) {
                for (const u8 of encodeToolCallDeltas(toolCallsFromMessage(msg).filter((tc) => !isPiToolName(tc.name)), chatId, created, displayModel, encoder)) {
                  controller.enqueue(u8);
                }
                for (const u8 of emitFinal(encoder, msg, chatId, created, displayModel, "tool_calls")) {
                  controller.enqueue(u8);
                }
                controller.close();
                return;
              }

              for (const u8 of emitFinal(encoder, msg, chatId, created, displayModel, "stop")) {
                controller.enqueue(u8);
              }
              controller.close();
              return;
            }
          }
        }

        ensureRole();
        controller.enqueue(
          encoder.encode(chatChunk(chatId, created, displayModel, {
            content: `\n[pi] tool loop exceeded (${MAX_TOOL_TURNS} turns)\n`,
          })),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        logger.error(`stream_error ${e instanceof Error ? e.stack || e.message : String(e)}`);
        controller.error(e instanceof Error ? e : new Error(String(e)));
      }
    },
    cancel(reason) {
      logger.debug(`client_cancel reason=${previewJson(reason)}`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
