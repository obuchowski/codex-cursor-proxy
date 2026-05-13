import type { Logger } from "./log";

type TunnelLogger = Pick<Logger, "info" | "error">;

function extractTunnelUrl(line: string, logger: TunnelLogger): void {
  const urlMatch = line.match(/https?:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/i);
  if (!urlMatch) return;

  logger.info(`OpenAI Base URL for Cursor: ${urlMatch[0]}`);
  logger.info("use API_KEY from .env as the API key in Cursor");
}

export function startCloudflareTunnel(
  port: number,
  tunnelName: string | undefined,
  logger: TunnelLogger & { debug?: (message: string) => void },
): void {
  const command = tunnelName
    ? ["cloudflared", "tunnel", "--url", `http://127.0.0.1:${port}`, "run", tunnelName]
    : ["cloudflared", "tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"];

  if (tunnelName) {
    logger.info(`Starting authenticated Cloudflare tunnel '${tunnelName}'`);
  } else {
    logger.info("Starting temporary Cloudflare tunnel (no account mode)");
  }

  try {
    const proc = Bun.spawn({
      cmd: command,
      stdout: "pipe",
      stderr: "pipe",
    });

    const decoder = new TextDecoder();
    const watch = async (stream: ReadableStream<Uint8Array> | null, isError: boolean) => {
      if (!stream) return;
      const reader = stream.getReader();
      let buffered = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            extractTunnelUrl(trimmed, logger);
            if (isError) logger.error(trimmed);
          }
        }
      } catch (error) {
        logger.error(`cloudflared stream error: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void watch(proc.stdout, false);
    void watch(proc.stderr, true);
    proc.unref();
  } catch (error) {
    logger.error(`failed to start cloudflared tunnel: ${error instanceof Error ? error.message : String(error)}`);
  }
}
