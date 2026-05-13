import { arch, platform, release } from "os";
import { API_URL, ORIGINATOR } from "../helpers/env";
import { readCodexAuthFile } from "../helpers/codex-auth-file";
import { asNonEmptyString, isRecord } from "../helpers/guards";

type CodexTokens = {
  id_token?: string;
  access_token?: string;
  account_id?: string;
};

type CodexAuthFile = Record<string, unknown> & {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  tokens?: CodexTokens;
};

type CodexAuth = {
  accessToken: string;
  accountId: string;
};

function parseJwtClaims(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return isRecord(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}

function extractAccountIdFromClaims(claims: Record<string, unknown> | undefined): string | undefined {
  if (!claims) return undefined;
  const root = asNonEmptyString(claims.chatgpt_account_id);
  if (root) return root;

  const authClaim = claims["https://api.openai.com/auth"];
  if (isRecord(authClaim)) {
    const nested = asNonEmptyString(authClaim.chatgpt_account_id);
    if (nested) return nested;
  }

  const organizations = claims.organizations;
  if (Array.isArray(organizations)) {
    const firstOrg = organizations.find(isRecord);
    return asNonEmptyString(firstOrg?.id);
  }

  return undefined;
}

function extractAccountId(tokens: CodexTokens): string | undefined {
  return (
    asNonEmptyString(tokens.account_id) ??
    extractAccountIdFromClaims(parseJwtClaims(tokens.id_token)) ??
    extractAccountIdFromClaims(parseJwtClaims(tokens.access_token))
  );
}

function normalizeTokens(tokens: unknown): CodexTokens {
  if (!isRecord(tokens)) return {};
  return {
    id_token: asNonEmptyString(tokens.id_token),
    access_token: asNonEmptyString(tokens.access_token),
    account_id: asNonEmptyString(tokens.account_id),
  };
}

export function getCodexAuth(): CodexAuth {
  const authFile = readCodexAuthFile() as CodexAuthFile;
  if (authFile.auth_mode === "apikey" || asNonEmptyString(authFile.OPENAI_API_KEY)) {
    throw new Error("Codex auth is in API-key mode. Run `codex login` and choose ChatGPT login.");
  }

  const tokens = normalizeTokens(authFile.tokens);
  const accessToken = asNonEmptyString(tokens.access_token);
  if (!accessToken) {
    throw new Error("No access token. Run `codex login` to authenticate with ChatGPT.");
  }

  const accountId = extractAccountId(tokens);
  if (!accountId) {
    throw new Error("No ChatGPT account id found. Run `codex login` again to refresh auth.json.");
  }

  return { accessToken, accountId };
}

function buildCodexHeaders(auth: CodexAuth): Record<string, string> {
  const USER_AGENT = `codex-cursor-proxy/0.1.2 (${platform()} ${release()}; ${arch()})`;
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${auth.accessToken}`,
    "chatgpt-account-id": auth.accountId,
    "OpenAI-Beta": "responses=experimental",
    originator: ORIGINATOR,
    "User-Agent": USER_AGENT,
  };
}

export function errorSummary(text: string): string {
  try {
    const payload = JSON.parse(text) as unknown;
    if (isRecord(payload) && isRecord(payload.error)) {
      const err = payload.error;
      const code = asNonEmptyString(err.code) ?? asNonEmptyString(err.type);
      const message = asNonEmptyString(err.message);
      return [code, message].filter(Boolean).join(": ") || text;
    }
  } catch {
    /* not JSON */
  }

  return text;
}

export async function fetchCodex(body: Record<string, unknown>): Promise<Response> {
  const auth = getCodexAuth();
  return fetch(API_URL, {
    method: "POST",
    headers: buildCodexHeaders(auth),
    body: JSON.stringify(body),
  });
}
