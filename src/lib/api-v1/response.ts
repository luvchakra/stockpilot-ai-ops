// Shared response helpers for the public REST API (SP-12). No secrets
// touched here, so this file is safe to import from anywhere (unlike the
// .server.ts modules alongside it).

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return jsonResponse({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error("[api-v1] unhandled error", err);
  return jsonResponse(
    { error: { code: "internal_error", message: "An unexpected error occurred." } },
    500,
  );
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Request body must be application/json.");
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_request", "Request body must be a valid JSON object.");
  }
}

// Whitelists the given keys from an untrusted request body -- callers
// never get to set columns (org_id, id, created_by, status, ...) beyond
// what a resource explicitly opts into.
export function pick(
  body: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in body) out[f] = body[f];
  }
  return out;
}
