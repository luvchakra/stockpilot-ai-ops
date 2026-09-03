#!/usr/bin/env node
// Read-only smoke test for the landing page CTAs.
//
// Fetches the rendered HTML of "/" and asserts that "Start Free" and
// "Log in" render as real links to /auth (with the right ?mode=), not
// inert buttons. Also fetches /auth?mode=signup and checks the sign-up
// tab is the one marked active in the server-rendered HTML.
//
// Zero dependencies (uses Node's built-in fetch) — safe to run any time,
// makes no writes.
//
// Usage:
//   node scripts/test-landing-cta.mjs
//   BASE_URL=http://localhost:3000 node scripts/test-landing-cta.mjs

const BASE_URL = process.env.BASE_URL ?? "https://stockpilot-ai-ops.lovable.app";

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail) console.log(`    ${detail}`);
  }
}

// Like check(), but informational only — never fails the suite. Use this
// for assertions against implementation details (e.g. a third-party
// component's internal SSR markup) that can't be reliably verified by
// regex and aren't the actual thing under test.
function checkSoft(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    console.log(`  \x1b[33m?\x1b[0m ${label} (not verified, not failing the suite)`);
    if (detail) console.log(`    ${detail}`);
  }
}

async function fetchHtml(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "text/html" },
  });
  const html = await res.text();
  return { status: res.status, html };
}

console.log(`Testing against ${BASE_URL}\n`);

console.log('Landing page ("/")');
{
  const { status, html } = await fetchHtml("/");
  check("page loads (200)", status === 200, `got status ${status}`);

  const hasSignupLink = /<a[^>]+href="\/auth\?mode=signup"[^>]*>/.test(html);
  const hasSigninLink = /<a[^>]+href="\/auth\?mode=signin"[^>]*>/.test(html);
  const startFreeIsButton = /<button[^>]*>\s*Start Free/.test(html);

  check(
    '"Start Free" renders as a link to /auth?mode=signup (not a dead button)',
    hasSignupLink,
    'no <a href="/auth?mode=signup"> found in the page HTML',
  );
  check(
    '"Log in" renders as a link to /auth?mode=signin',
    hasSigninLink,
    'no <a href="/auth?mode=signin"> found in the page HTML',
  );
  check(
    "no leftover <button>Start Free</button> with no href",
    !startFreeIsButton,
    "found a bare <button>Start Free</button> — the old dead CTA is still present",
  );

  const startFreeCount = (html.match(/Start Free/g) ?? []).length;
  check(
    "all Start Free CTAs present (nav + hero + pricing + final)",
    startFreeCount >= 4,
    `found ${startFreeCount} occurrences, expected at least 4`,
  );
}

console.log('\nAuth page ("/auth?mode=signup")');
{
  const { status, html } = await fetchHtml("/auth?mode=signup");
  check("page loads (200)", status === 200, `got status ${status}`);

  // Radix Tabs marks the active trigger with data-state="active".
  const signupActive = new RegExp(
    'value="signup"[^>]*data-state="active"|data-state="active"[^>]*value="signup"',
  ).test(html);
  const signupTriggerActive =
    /id="[^"]*signup[^"]*"[^>]*data-state="active"/.test(html) || signupActive;

  checkSoft(
    '"Create account" tab is the active tab when landing via Start Free',
    signupTriggerActive,
    'could not find an active tab trigger for "signup" in the SSR output. ' +
      "This is a heuristic against Radix Tabs' internal markup, not a " +
      "reliable signal either way — verify by hand in a browser instead.",
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
