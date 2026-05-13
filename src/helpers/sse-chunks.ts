type ChatFinishReason = "stop" | "tool_calls";

export function chatChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finish: string | null = null,
): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

export function chatFinalChunks(
  id: string,
  created: number,
  model: string,
  finish: ChatFinishReason,
  usage?: Record<string, number | undefined>,
): string[] {
  const final = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
    ...(usage && { usage }),
  };

  return [`data: ${JSON.stringify(final)}\n\n`, "data: [DONE]\n\n"];
}
