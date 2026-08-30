#!/usr/bin/env node
// One-off utility: prints the SUPABASE_SERVICE_ROLE_KEY that is already
// configured in whatever server-side environment this runs in.
//
// This project's src/integrations/supabase/client.server.ts already
// depends on process.env.SUPABASE_SERVICE_ROLE_KEY existing, so Lovable
// Cloud has it configured for this project even if you don't have a
// separate Supabase dashboard login.
//
// HOW TO USE THIS IN LOVABLE:
// Ask Lovable (in its chat) to run this file server-side once — e.g.
// "run scripts/reveal-service-role-key.mjs and show me the output" — or,
// if Lovable exposes a server functions / edge functions console, invoke
// it there. Copy the printed value immediately, then paste it into the
// GitHub secret (see scripts/set-github-secret.mjs or the manual UI
// path). Do not leave this printing to a public-facing log, and do not
// paste the output back into any chat that isn't private to you.
//
// This intentionally does nothing if the variable is missing, rather
// than guessing or fetching it from anywhere else.

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!key) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set in this environment.\n" +
      "This has to run somewhere that already has it configured " +
      "(e.g. Lovable Cloud's server runtime for this project).",
  );
  process.exit(1);
}

console.log("SUPABASE_SERVICE_ROLE_KEY:");
console.log(key);
