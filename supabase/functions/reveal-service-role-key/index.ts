// ONE-OFF, TEMPORARY utility — delete this function immediately after use.
//
// Lovable Cloud injects SUPABASE_SERVICE_ROLE_KEY automatically into
// Edge Function environments (Deno.env.get), so this is the fastest way
// to get its value if you don't have separate Supabase dashboard access.
//
// This never returns the key in the HTTP response, even to a public
// invocation URL — it only writes it to this function's execution logs
// (Supabase/Lovable dashboard → Functions → Logs), which only you can
// see. Invoke this once, read the value from the logs, paste it into
// the GitHub Actions secret (see scripts/set-github-secret.mjs or add
// it manually under repo Settings → Secrets and variables → Actions →
// SUPABASE_SERVICE_ROLE_KEY), then delete this function.

Deno.serve(async (_req) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!key) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set in this function's environment.");
    return new Response("SUPABASE_SERVICE_ROLE_KEY is not set.", { status: 500 });
  }

  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${key}`);

  return new Response(
    "Printed to this function's execution logs (Functions → Logs). " +
      "Copy it from there, then delete this function.",
  );
});
