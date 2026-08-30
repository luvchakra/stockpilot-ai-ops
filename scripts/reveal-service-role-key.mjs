#!/usr/bin/env node
// One-off utility: prints the SUPABASE_SERVICE_ROLE_KEY that is already
// configured in this project's Node/TanStack server environment.
//
// This project's src/integrations/supabase/client.server.ts already
// depends on process.env.SUPABASE_SERVICE_ROLE_KEY existing, so Lovable
// Cloud has it configured for this project even if you don't have a
// separate Supabase dashboard login.
//
// If you're working in a Supabase/Lovable Edge Function (Deno, not
// Node) instead, process.env won't exist there — use
// supabase/functions/reveal-service-role-key/index.ts instead, which
// reads it via Deno.env.get("SUPABASE_SERVICE_ROLE_KEY").
//
// HOW TO USE THIS ONE: ask Lovable (in its chat) to run this file
// server-side once — e.g. "run scripts/reveal-service-role-key.mjs and
// show me the output". Copy the printed value immediately, then paste
// it into the GitHub secret (see scripts/set-github-secret.mjs or the
// manual UI path). Do not leave this printing to a public-facing log,
// and do not paste the output back into any chat that isn't private to
// you.
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
