// Server functions backing the API Keys panel in Organization Settings
// (SP-12). Generation snapshots the CALLING user's role's current
// permission set onto the new key (see the migration's header comment
// for why a fixed snapshot rather than a live pointer to their role).
//
// requireSupabaseAuth scopes every read/write to the caller's own JWT,
// so the actual authorization -- only settings.manage holders may
// create/list/revoke a key -- is enforced by ordinary RLS on api_keys/
// api_key_secrets, not re-implemented here.
import { createServerFn } from "@tanstack/react-start";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function generateRawKey(): string {
  return `sk_live_${randomBytes(24).toString("hex")}`;
}

const generateInput = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});

export const generateApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => generateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("Not a member of this organization.");

    const { data: perms, error: permError } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .eq("role", membership.role);
    if (permError) throw new Error(`Could not resolve permissions: ${permError.message}`);

    const rawKey = generateRawKey();
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    const { data: created, error } = await supabase
      .from("api_keys")
      .insert({
        org_id: data.orgId,
        name: data.name,
        key_prefix: keyPrefix,
        permissions: (perms ?? []).map((p) => p.permission_key),
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create API key: ${error.message}`);

    const { error: secretError } = await supabase
      .from("api_key_secrets")
      .insert({ api_key_id: created.id, key_hash: keyHash });
    if (secretError) throw new Error(`Could not store API key: ${secretError.message}`);

    // The only time the raw key is ever returned -- the UI must show it
    // once and never again, matching key_hash having no SELECT policy.
    return { id: created.id, rawKey };
  });

const listInput = z.object({ orgId: z.string().uuid() });

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, permissions, created_at, last_used_at, revoked_at")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not list API keys: ${error.message}`);
    return rows ?? [];
  });

const revokeInput = z.object({ id: z.string().uuid() });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => revokeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(`Could not revoke API key: ${error.message}`);
  });
