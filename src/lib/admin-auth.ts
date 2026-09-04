// Gate for the platform-admin tools under /admin (currently just the demo
// seed-data page). This is deliberately separate from org_role -- those
// roles are scoped to a single organization, while /admin can act across
// every organization on the platform, so it needs its own, narrower gate.
//
// Access is controlled purely by the server-side PLATFORM_ADMIN_EMAILS env
// var (comma-separated emails, matched case-insensitively against the
// caller's verified JWT email claim). There's no UI-only hiding here: every
// admin server function re-checks this via requirePlatformAdmin, so a
// non-admin can't reach the seeding/deletion endpoints no matter what the
// client renders.
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function platformAdminEmails(): string[] {
  return (process.env["PLATFORM_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function callerEmail(claims: { email?: string }): string | undefined {
  return claims.email?.toLowerCase();
}

export const requirePlatformAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const email = callerEmail(context.claims);
    const admins = platformAdminEmails();
    if (!email || admins.length === 0 || !admins.includes(email)) {
      throw new Error("Forbidden: this account does not have platform admin access.");
    }
    return next({ context: { ...context, adminEmail: email } });
  });

// Cheap, side-effect-free check the UI uses to decide whether to show the
// admin nav link at all. Not itself a security boundary -- requirePlatformAdmin
// on each admin server function is what actually protects the data.
export const isPlatformAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = callerEmail(context.claims);
    const admins = platformAdminEmails();
    return { isAdmin: !!email && admins.includes(email) };
  });
