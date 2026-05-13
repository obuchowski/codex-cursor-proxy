/** Responses API SSE → OpenAI Chat Completions SSE (for Cursor). */
import { chatChunk, chatFinalChunks } from "../helpers/sse-chunks";

export function responsesToCompletionsStream(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  let id = "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const toolCallsByItemId = new Map<string, { index: number; id: string | undefined }>();
  let sawToolCall = false;
  let sentAssistantRole = false;

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        function parseSseEvent(rawEvent: string) {
          const lines = rawEvent.split(/\r?\n/);
          const dataLines: string[] = [];
          let event = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              event = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice("data:".length).trimStart());
            }
          }
          if (dataLines.length === 0) return null;
          try {
            return {
              event,
              data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
            };
          } catch {
            return null;
          }
        }

        function ensureAssistantRole() {
          if (!sentAssistantRole) {
            controller.enqueue(encoder.encode(chatChunk(id, created, model, { role: "assistant" })));
            sentAssistantRole = true;
          }
        }

        function emitFinalChunk(
          outputModel: string,
          finishReason: "stop" | "tool_calls",
          usage?: Record<string, unknown>,
        ) {
          for (const chunk of chatFinalChunks(id, created, outputModel, finishReason, {
            prompt_tokens: usage?.input_tokens as number,
            completion_tokens: usage?.output_tokens as number,
            total_tokens: usage?.total_tokens as number,
          })) {
            if (chunk) {
              controller.enqueue(encoder.encode(chunk));
            }
          }
        }

        function handleEvent(rawEvent: string) {
          const parsed = parseSseEvent(rawEvent);
          if (!parsed) return;

          const type = (parsed.data.type as string) ?? parsed.event;
          const response = parsed.data.response as Record<string, unknown> | undefined;
          const outputModel = (response?.model as string) ?? model;

          if (type === "response.output_text.delta") {
            const delta = parsed.data.delta as string;
            if (!delta) return;
            ensureAssistantRole();
            controller.enqueue(encoder.encode(chatChunk(id, created, model, { content: delta })));
            return;
          }

          if (type === "response.output_item.added") {
            const item = parsed.data.item as Record<string, unknown> | undefined;
            if (item?.type !== "function_call") return;
            const index = typeof parsed.data.output_index === "number" ? parsed.data.output_index : toolCallsByItemId.size;
            const callId = (item.call_id as string | undefined) ?? (item.id as string | undefined);
            const itemId = item.id as string | undefined;
            if (!itemId) return;
            sawToolCall = true;
            ensureAssistantRole();
            toolCallsByItemId.set(itemId, { index, id: callId });
            controller.enqueue(
              encoder.encode(
                chatChunk(id, created, model, {
                  tool_calls: [
                    {
                      index,
                      id: callId,
                      type: "function",
                      function: { name: item.name as string, arguments: "" },
                    },
                  ],
                }),
              ),
            );
            return;
          }

          if (type === "response.function_call_arguments.delta") {
            const delta = parsed.data.delta as string;
            const itemId = parsed.data.item_id as string | undefined;
            if (!delta || !itemId) return;
            const toolCall = toolCallsByItemId.get(itemId);
            if (!toolCall) return;
            sawToolCall = true;
            ensureAssistantRole();
            controller.enqueue(
              encoder.encode(chatChunk(id, created, model, { tool_calls: [{ index: toolCall.index, function: { arguments: delta } }] })),
            );
            return;
          }

          if (type === "response.output_item.done") {
            const item = parsed.data.item as Record<string, unknown> | undefined;
            const itemId = item?.id as string | undefined;
            if (item?.type !== "function_call" || !itemId || toolCallsByItemId.has(itemId)) return;
            const index = typeof parsed.data.output_index === "number" ? parsed.data.output_index : toolCallsByItemId.size;
            const callId = (item.call_id as string | undefined) ?? itemId;
            const argumentsText = typeof item.arguments === "string" ? item.arguments : "";
            sawToolCall = true;
            ensureAssistantRole();
            controller.enqueue(
              encoder.encode(
                chatChunk(id, created, model, {
                  tool_calls: [
                    {
                      index,
                      id: callId,
                      type: "function",
                      function: { name: item.name as string, arguments: argumentsText },
                    },
                  ],
                }),
              ),
            );
            return;
          }

          if (type === "response.failed") {
            const message =
              (response?.error as Record<string, unknown> | undefined)?.message ?? "Responses stream failed.";
            controller.error(new Error(String(message)));
            return;
          }

          if (type === "response.completed") {
            if (response?.id) id = response.id as string;
            emitFinalChunk(outputModel, sawToolCall ? "tool_calls" : "stop", response?.usage as Record<string, unknown> | undefined);
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.search(/\r?\n\r?\n/);
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
            buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
            handleEvent(rawEvent);
            boundary = buffer.search(/\r?\n\r?\n/);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleEvent(buffer);
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}
