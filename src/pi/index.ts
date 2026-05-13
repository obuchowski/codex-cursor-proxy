#!/usr/bin/env bun
import { createLogger } from "../helpers/log";
import { corsPreflight, withRequestId, validateBearer } from "../helpers/http";
import { inputItemCount, inputTailSummary } from "../helpers/request-summary";
import { parseCli } from "../helpers/cli";
import { sanitizeBody } from "../helpers/sanitize";
import { startCloudflareTunnel } from "../helpers/cloudflared";
import { API_KEY, CLOUDFLARE_TUNNEL_NAME, ORIGINATOR, PORT } from "../helpers/env";
import { runCodexViaPi } from "./pi-bridge";

const { debug, projectCwd } = parseCli();
const logger = createLogger(debug);

if (!API_KEY) {
  logger.error("Set API_KEY in .env");
  process.exit(1);
}

logger.info(`listening on ${PORT}; cwd=${projectCwd}`);

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
      return withRequestId(authError, requestId);
    }

    if (req.method !== "POST") {
      return withRequestId(Response.json({ error: "Method not allowed" }, { status: 405 }), requestId);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = (await req.json()) as Record<string, unknown>;
    } catch {
      logger.warn(`[${requestId}] invalid json`);
      return withRequestId(Response.json({ error: "Invalid JSON" }, { status: 400 }), requestId);
    }

    const body = sanitizeBody(parsed);
    const model = (body.model as string) ?? "gpt-5.4";
    logger.info(`[${requestId}] POST /chat/completions model=${model} input_items=${inputItemCount(body)}`);
    logger.debug(`[${requestId}] input_tail ${inputTailSummary(body)}`);

    let out: Response;
    try {
      out = await runCodexViaPi({
        parsed: body,
        originator: ORIGINATOR,
        projectCwd,
        requestId,
        debug,
      });
    } catch (error) {
      return withRequestId(Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 401 }), requestId);
    }

    if (out.status === 400) {
      const text = await out.text();
      return withRequestId(new Response(text, { status: 400, headers: { "Content-Type": "application/json" } }), requestId);
    }

    return withRequestId(out, requestId);
  },
});

startCloudflareTunnel(PORT, CLOUDFLARE_TUNNEL_NAME, logger);
