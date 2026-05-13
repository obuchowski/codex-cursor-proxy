#!/usr/bin/env bun
import { createLogger } from "../helpers/log";
import { withRequestId, validateBearer, corsPreflight } from "../helpers/http";
import { inputItemCount, inputTailSummary } from "../helpers/request-summary";
import { parseCli } from "../helpers/cli";
import { sanitizeBody } from "../helpers/sanitize";
import { startCloudflareTunnel } from "../helpers/cloudflared";
import { API_KEY, CLOUDFLARE_TUNNEL_NAME, PORT } from "../helpers/env";
import { errorSummary, fetchCodex } from "./codex-auth";
import { responsesToCompletionsStream } from "./responses-sse";

const { debug } = parseCli();
const log = createLogger(debug);

if (!API_KEY) {
  log.error("Set API_KEY in .env");
  process.exit(1);
}

log.info(`Starting on port ${PORT}`);

Bun.serve({
  port: PORT,
  idleTimeout: 255,

  async fetch(req) {
    const requestId = crypto.randomUUID().slice(0, 8);

    if (req.method === "OPTIONS") {
      return withRequestId(corsPreflight(), requestId);
    }

    const authError = validateBearer(req, API_KEY);
    if (authError) {
      log.warn(`[${requestId}] unauthorized`);
      return withRequestId(authError, requestId);
    }

    if (req.method !== "POST") {
      return withRequestId(Response.json({ error: "Method not allowed" }, { status: 405 }), requestId);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = (await req.json()) as Record<string, unknown>;
    } catch {
      log.warn(`[${requestId}] invalid json`);
      return withRequestId(Response.json({ error: "Invalid JSON" }, { status: 400 }), requestId);
    }

    const body = sanitizeBody(parsed);
    const model = (body.model as string) ?? "gpt-5.4";
    log.info(`[${requestId}] POST /chat/completions model=${model} input_items=${inputItemCount(body)}`);
    log.debug(`[${requestId}] input_tail ${inputTailSummary(body)}`);

    let upstream: Response;
    try {
      upstream = await fetchCodex(body);
    } catch (error) {
      log.error(`[${requestId}] upstream auth error: ${error instanceof Error ? error.message : String(error)}`);
      return withRequestId(
        Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 401 }),
        requestId,
      );
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      log.warn(`[${requestId}] upstream ${upstream.status} ${upstream.statusText}: ${errorSummary(text)}`);
      return withRequestId(
        new Response(text, { status: upstream.status, headers: { "Content-Type": "application/json" } }),
        requestId,
      );
    }

    if (!upstream.body) {
      log.error(`[${requestId}] empty upstream response`);
      return withRequestId(Response.json({ error: "Empty upstream response" }, { status: 502 }), requestId);
    }

    return withRequestId(
      new Response(responsesToCompletionsStream(upstream.body, model), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }),
      requestId,
    );
  },
});

startCloudflareTunnel(PORT, CLOUDFLARE_TUNNEL_NAME, log);
