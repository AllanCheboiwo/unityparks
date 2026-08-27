import { describe, expect, it } from "vitest";
import { createZohoClient } from "./client";

/**
 * Frozen suite for UNP-5 (docs/zoho-accounting-plan.md): the OAuth token
 * lifecycle around every Zoho Books call, with fetch injected so no network
 * is involved. Covers spec edge case 8 (expired access token is refreshed
 * transparently).
 */

const ENV = {
  clientId: "client-1",
  clientSecret: "secret-1",
  refreshToken: "refresh-1",
  orgId: "org-1",
};

type Recorded = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch fake: token endpoint mints sequential tokens, API responses play from a script. */
function makeFetch(apiResponses: Array<() => Response>) {
  const calls: Recorded[] = [];
  let tokensMinted = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes("/oauth/v2/token")) {
      tokensMinted += 1;
      return jsonResponse(200, { access_token: `token-${tokensMinted}`, expires_in: 3600 });
    }
    const next = apiResponses.shift();
    if (!next) throw new Error("fetch fake ran out of scripted responses");
    return next();
  };
  return {
    fetchImpl,
    calls,
    tokenCalls: () => calls.filter((c) => c.url.includes("/oauth/v2/token")),
    apiCalls: () => calls.filter((c) => !c.url.includes("/oauth/v2/token")),
  };
}

describe("createZohoClient", () => {
  it("fetches an access token with the refresh token, then calls the API with it", async () => {
    const fetch = makeFetch([() => jsonResponse(200, { code: 0, invoice: { invoice_id: "i1" } })]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    await client.request("GET", "/invoices/i1");

    const tokenCall = fetch.tokenCalls()[0];
    expect(String(tokenCall.init.body)).toContain("refresh_token=refresh-1");
    expect(String(tokenCall.init.body)).toContain("grant_type=refresh_token");

    const apiCall = fetch.apiCalls()[0];
    expect(new Headers(apiCall.init.headers).get("Authorization")).toBe(
      "Zoho-oauthtoken token-1",
    );
    expect(apiCall.url).toContain("organization_id=org-1");
  });

  it("caches the access token across calls instead of minting one per request", async () => {
    const fetch = makeFetch([
      () => jsonResponse(200, { code: 0 }),
      () => jsonResponse(200, { code: 0 }),
    ]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    await client.request("GET", "/invoices");
    await client.request("GET", "/invoices");

    expect(fetch.tokenCalls()).toHaveLength(1);
  });

  it("refreshes once and retries when Zoho says the token expired", async () => {
    const fetch = makeFetch([
      () => jsonResponse(401, { code: 57, message: "token expired" }),
      () => jsonResponse(200, { code: 0, invoice: { invoice_id: "i1" } }),
    ]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    const result = await client.request<{ invoice: { invoice_id: string } }>(
      "GET",
      "/invoices/i1",
    );

    expect(result.invoice.invoice_id).toBe("i1");
    expect(fetch.tokenCalls()).toHaveLength(2);
    const retry = fetch.apiCalls()[1];
    expect(new Headers(retry.init.headers).get("Authorization")).toBe("Zoho-oauthtoken token-2");
  });

  it("does not retry a second consecutive 401, so a revoked refresh token fails loudly", async () => {
    const fetch = makeFetch([
      () => jsonResponse(401, { code: 57, message: "token expired" }),
      () => jsonResponse(401, { code: 57, message: "token expired" }),
    ]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    await expect(client.request("GET", "/invoices")).rejects.toThrow(/401|expired/i);
    expect(fetch.apiCalls()).toHaveLength(2);
  });

  it("surfaces Zoho's error message when the API answers with a non-zero code", async () => {
    const fetch = makeFetch([
      () =>
        jsonResponse(200, { code: 110701, message: "Please enter the reason for updating" }),
    ]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    await expect(client.request("PUT", "/invoices/i1", { total: 1 })).rejects.toThrow(
      /reason for updating/,
    );
  });

  it("sends request bodies as JSON", async () => {
    const fetch = makeFetch([() => jsonResponse(200, { code: 0 })]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    await client.request("POST", "/invoices", { reference_number: "APALEO-BK-1" });

    const apiCall = fetch.apiCalls()[0];
    expect(new Headers(apiCall.init.headers).get("Content-Type")).toContain("application/json");
    expect(JSON.parse(String(apiCall.init.body))).toEqual({ reference_number: "APALEO-BK-1" });
  });
});
