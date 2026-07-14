// One-time Pesapal setup: register our IPN URL and print the ipn_id to put
// in .env as PESAPAL_IPN_ID. Checkout refuses to run the Pesapal path until
// that id exists, so this script is the switch that turns real payments on.
//
// Run from the repo root:
//   node scripts/register-pesapal-ipn.mjs [url]
//
// With no argument it registers `${APP_BASE_URL}/api/payments/pesapal/ipn`.
// Registering a URL that already exists returns the existing ipn_id (safe to
// re-run), but the shared sandbox merchant rate-limits this endpoint hard -
// if you see "Too many requests", wait a minute and try again.
import { readFileSync } from "node:fs";

// The .env loader Prisma gives our other scripts for free, done by hand
// here because this script never touches the database.
function loadEnv() {
  let text;
  try {
    text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

loadEnv();

const baseUrl = process.env.PESAPAL_BASE_URL ?? "https://cybqa.pesapal.com/pesapalv3";
const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
if (!consumerKey || !consumerSecret) {
  console.error("Missing PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET in .env");
  process.exit(1);
}

const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const ipnUrl = process.argv[2] ?? `${appBaseUrl}/api/payments/pesapal/ipn`;

const tokenRes = await fetch(`${baseUrl}/api/Auth/RequestToken`, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret }),
});
const tokenBody = await tokenRes.json();
if (!tokenBody.token || tokenBody.error) {
  console.error("Pesapal token request failed:", JSON.stringify(tokenBody.error ?? tokenBody));
  process.exit(1);
}

const registerRes = await fetch(`${baseUrl}/api/URLSetup/RegisterIPN`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokenBody.token}`,
  },
  body: JSON.stringify({ url: ipnUrl, ipn_notification_type: "GET" }),
});
const registerBody = await registerRes.json();
if (!registerBody.ipn_id || registerBody.error) {
  console.error("RegisterIPN failed:", JSON.stringify(registerBody.error ?? registerBody));
  process.exit(1);
}

console.log(`Registered IPN URL: ${registerBody.url}`);
console.log(`Notification type:  ${registerBody.ipn_notification_type_description ?? "GET"}`);
console.log("");
console.log("Add this line to .env:");
console.log(`PESAPAL_IPN_ID="${registerBody.ipn_id}"`);
