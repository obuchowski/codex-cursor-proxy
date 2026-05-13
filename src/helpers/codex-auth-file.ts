import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const AUTH_PATH = join(process.env.HOME ?? homedir(), ".codex", "auth.json");

export function readCodexAuthFile(): Record<string, unknown> {
  try {
    const raw = readFileSync(AUTH_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
