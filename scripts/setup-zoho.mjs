// One-time Zoho Books setup (UNP-5): create the generic customer every
// invoice hangs off and print the id to put in .env.local and Railway as
// ZOHO_CUSTOMER_ID. One shared customer is the no-PII design: no guest
// name or email ever becomes a Zoho contact.
//
// Run from the repo root:
//   node scripts/setup-zoho.mjs
//
// Safe to re-run: an existing "Unity Parks Online Guest" contact is
// adopted, never duplicated. Needs ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
// ZOHO_REFRESH_TOKEN and ZOHO_ORG_ID in the environment (.env.local).
import { readFileSync } from "node:fs";

const CUSTOMER_NAME = "Unity Parks Online Guest";
const TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const API_BASE = "https://www.zohoapis.com/books/v3";

// The .env loader Prisma gives our other scripts for free, done by hand
// here because this script never touches the database. .env.local wins,
// matching Next's own precedence.
function loadEnv() {
  for (const file of ["../.env.local", "../.env"]) {
    let text;
    try {
      text = readFileSync(new URL(file, import.meta.url), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

loadEnv();
const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID } = process.env;
if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID) {
  console.error(
    "Missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_ORG_ID in .env.local",
  );
  process.exit(1);
}

const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
  }),
});
const tokenBody = await tokenRes.json();
if (!tokenRes.ok || !tokenBody.access_token) {
  console.error("Zoho token refresh failed:", JSON.stringify(tokenBody));
  process.exit(1);
}

async function zoho(method, path, body) {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}organization_id=${ZOHO_ORG_ID}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenBody.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok || (parsed && typeof parsed.code === "number" && parsed.code !== 0)) {
    throw new Error(`Zoho ${method} ${path} failed: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

const search = await zoho(
  "GET",
  `/contacts?contact_name=${encodeURIComponent(CUSTOMER_NAME)}`,
);
const existing = (search.contacts ?? []).find((c) => c.contact_name === CUSTOMER_NAME);

let customerId;
if (existing) {
  customerId = existing.contact_id;
  console.log(`Adopted existing contact "${CUSTOMER_NAME}".`);
} else {
  const created = await zoho("POST", "/contacts", {
    contact_name: CUSTOMER_NAME,
    contact_type: "customer",
  });
  customerId = created.contact.contact_id;
  console.log(`Created contact "${CUSTOMER_NAME}".`);
}

console.log("\nAdd this to .env.local (and to Railway's variables when deploying):\n");
console.log(`ZOHO_CUSTOMER_ID=${customerId}`);
