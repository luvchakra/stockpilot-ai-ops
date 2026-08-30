#!/usr/bin/env node
// Sets (or updates) a GitHub Actions repository secret via the GitHub API.
//
// GitHub requires secret values to be sealed-box encrypted with the
// repo's own public key before upload (plaintext is never sent), which
// is why this needs the `libsodium-wrappers` package rather than
// Node's built-in crypto (no XSalsa20-Poly1305 sealed box there).
//
// Setup (run these on your own machine — this will not work in a
// sandbox with restricted network/package access):
//   npm install libsodium-wrappers
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx node scripts/set-github-secret.mjs \
//     --repo luvchakra/stockpilot-ai-ops \
//     --name SUPABASE_SERVICE_ROLE_KEY
//
// It will prompt for the secret value with input hidden (never pass the
// secret value itself as a CLI arg or env var — that leaks into shell
// history / process listings). GITHUB_TOKEN needs a personal access
// token (classic, `repo` scope, or fine-grained with "Secrets: write"
// on this repository).

import sodium from "libsodium-wrappers";

function parseArgs() {
  const args = { repo: null, name: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") args.repo = argv[++i];
    else if (argv[i] === "--name") args.name = argv[++i];
  }
  return args;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = "";
    process.stdout.write(question);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const CTRL_C = String.fromCharCode(3);
    const CTRL_D = String.fromCharCode(4);
    const BACKSPACE = String.fromCharCode(127);
    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === CTRL_D) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (char === CTRL_C) {
        process.exit(1);
      } else if (char === BACKSPACE || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const { repo, name } = parseArgs();
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !name) {
    console.error("Usage: GITHUB_TOKEN=... node scripts/set-github-secret.mjs --repo owner/repo --name SECRET_NAME");
    process.exit(1);
  }
  if (!token) {
    console.error("Set GITHUB_TOKEN to a personal access token with write access to Actions secrets.");
    process.exit(1);
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error(`--repo must be "owner/repo", got: ${repo}`);
    process.exit(1);
  }

  const secretValue = await promptHidden(`Paste the value for ${name} (hidden): `);
  if (!secretValue) {
    console.error("Empty value, aborting.");
    process.exit(1);
  }

  const api = (path, init) =>
    fetch(`https://api.github.com/repos/${owner}/${repoName}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
    });

  console.log("Fetching repo public key...");
  const keyRes = await api("/actions/secrets/public-key");
  if (!keyRes.ok) {
    console.error(`Could not fetch public key: ${keyRes.status} ${await keyRes.text()}`);
    process.exit(1);
  }
  const { key, key_id } = await keyRes.json();

  await sodium.ready;
  const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const binsec = sodium.from_string(secretValue);
  const encryptedBytes = sodium.crypto_box_seal(binsec, binkey);
  const encrypted_value = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);

  console.log(`Setting secret ${name} on ${repo}...`);
  const putRes = await api(`/actions/secrets/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_value, key_id }),
  });

  if (putRes.status === 201) {
    console.log(`Created secret ${name}.`);
  } else if (putRes.status === 204) {
    console.log(`Updated existing secret ${name}.`);
  } else {
    console.error(`Failed: ${putRes.status} ${await putRes.text()}`);
    process.exit(1);
  }
}

main();
