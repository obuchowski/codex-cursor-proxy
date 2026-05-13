import { stream } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";

const dummyContext = {
  messages: [{ role: "user" as const, content: " ", timestamp: Date.now() }],
};

export function streamCodexOnce(
  body: Record<string, unknown>,
  model: Model<"openai-codex-responses">,
  apiKey: string,
  originator: string,
): AssistantMessageEventStream {
  return stream(model, dummyContext, {
    apiKey,
    transport: "sse",
    headers: { originator },
    onPayload: () => body,
  });
}
