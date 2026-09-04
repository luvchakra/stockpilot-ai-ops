// API key resolution for the public REST API (SP-12).
//
// This runs entirely as service_role (there's no Supabase session on an
// incoming API request, unlike a browser call from the SPA), so it is
// solely responsible for two things ordinary RLS/has_permission() would
// otherwise provide for free: scoping every downstream query to the
// key's own org_id, and checking the key's permission snapshot before
// any write. See the migration header comment
// (20260914000000_public_api_v1.sql) for why the snapshot is fixed at
// creation time rather than a live pointer to the issuing user's role.
import { createHash } from "node:crypto";
import { ApiError } from "./response";

export interface ApiKeyContext {
  id: string;
  orgId: string;
  createdBy: string;
  permissions: string[];
}

// A sane default requests-per-minute-per-org ceiling (ticket: "at
// minimum a sane default to prevent abuse"). Tiering by plan is a
// fast-follow once a pricing model exists to hang tiers off of.
const RATE_LIMIT_PER_MINUTE = 120;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export async function resolveApiKey(request: Request): Promise<ApiKeyContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(sk_live_[a-f0-9]{32,})$/.exec(header.trim());
  if (!match) {
    throw new ApiError(
      401,
      "unauthorized",
      "Missing or malformed Authorization header. Expected 'Authorization: Bearer sk_live_...'.",
    );
  }
  const hash = hashApiKey(match[1]!);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: secret } = await supabaseAdmin
    .from("api_key_secrets")
    .select("api_key_id")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!secret) {
    throw new ApiError(401, "unauthorized", "Invalid API key.");
  }

  const { data: key } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, created_by, permissions, revoked_at")
    .eq("id", secret.api_key_id)
    .maybeSingle();
  if (!key) {
    throw new ApiError(401, "unauthorized", "Invalid API key.");
  }
  if (key.revoked_at) {
    throw new ApiError(401, "unauthorized", "This API key has been revoked.");
  }

  // Best-effort, fire-and-forget -- a failed audit-timestamp write should
  // never block the actual request.
  void supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id);

  const { data: withinLimit, error: limitError } = await supabaseAdmin.rpc("check_api_rate_limit", {
    _org_id: key.org_id,
    _limit: RATE_LIMIT_PER_MINUTE,
  });
  if (limitError) {
    throw new ApiError(500, "internal_error", "Could not verify the request rate limit.");
  }
  if (withinLimit === false) {
    throw new ApiError(
      429,
      "rate_limited",
      `This organization has exceeded ${RATE_LIMIT_PER_MINUTE} requests/minute. Try again shortly.`,
    );
  }

  return {
    id: key.id,
    orgId: key.org_id,
    createdBy: key.created_by,
    permissions: key.permissions ?? [],
  };
}

export function requirePermission(ctx: ApiKeyContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) {
    throw new ApiError(
      403,
      "forbidden",
      `This API key does not have the '${permission}' permission. Reissue it from a role that has it.`,
    );
  }
}
