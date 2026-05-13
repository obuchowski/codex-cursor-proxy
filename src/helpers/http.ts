export function corsPreflight(): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-proxy-request-id", requestId);
  return response;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization")?.trim();
  if (!header) return null;

  const [scheme, token, extra] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;

  return token;
}

export function validateBearer(req: Request, apiKey: string): Response | null {
  if (!apiKey) {
    return Response.json({ error: "API_KEY is not set in .env" }, { status: 500 });
  }
  const token = bearerToken(req);
  if (!token || token !== apiKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return null;
}
