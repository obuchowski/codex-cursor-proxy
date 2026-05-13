import { join } from "node:path";
import { config } from "dotenv";

config({ path: join(import.meta.dir, "..", "..", ".env") });

export const API_URL = "https://chatgpt.com/backend-api/codex/responses";
export const HOME = process.env.HOME ?? "~";
export const PORT = 3000;
export const API_KEY = process.env.API_KEY ?? "";
export const ORIGINATOR = "codex-cursor-proxy";
export const CLOUDFLARE_TUNNEL_NAME = process.env.CLOUDFLARE_TUNNEL_NAME?.trim();
