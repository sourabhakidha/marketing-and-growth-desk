// Small HTTP helpers shared by Netlify Functions. No secrets are ever echoed.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export type ErrorCode =
  | "unauthenticated"
  | "not_a_member"
  | "forbidden"
  | "not_configured"
  | "bad_request"
  | "method_not_allowed"
  | "upstream_error";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  not_a_member: 403,
  forbidden: 403,
  not_configured: 503,
  bad_request: 400,
  method_not_allowed: 405,
  upstream_error: 502,
};

export class HttpError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
  }
  toResponse(): Response {
    return json({ error: { code: this.code, message: this.message } }, STATUS[this.code]);
  }
}

/** Extracts a bearer token; returns null when absent or malformed. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/** Wraps a handler so thrown HttpErrors become safe JSON responses. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return err.toResponse();
      // Log the failure without request headers/bodies (may contain tokens)
      console.error("unhandled function error", err instanceof Error ? err.message : "unknown");
      return json({ error: { code: "upstream_error", message: "Unexpected server error" } }, 500);
    }
  };
}
