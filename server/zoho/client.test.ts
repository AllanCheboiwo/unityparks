import { describe, expect, it } from "vitest";
import { createZohoBooksApi, createZohoClient } from "./client";

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

/**
 * A fetch fake: the token endpoint mints sequential tokens (unless a scripted
 * token response is queued), API responses play from a script.
 */
function makeFetch(
  apiResponses: Array<() => Response>,
  tokenResponses: Array<() => Response> = [],
) {
  const calls: Recorded[] = [];
  let tokensMinted = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes("/oauth/v2/token")) {
      const scripted = tokenResponses.shift();
      if (scripted) return scripted();
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
    // Pinned to the US DC on purpose: the org lives there, and an earlier
    // Canadian-DC account was abandoned for exactly this confusion.
    expect(tokenCall.url.startsWith("https://accounts.zoho.com/oauth/v2/token")).toBe(true);

    const apiCall = fetch.apiCalls()[0];
    expect(new Headers(apiCall.init.headers).get("Authorization")).toBe(
      "Zoho-oauthtoken token-1",
    );
    expect(apiCall.url).toContain("organization_id=org-1");
    expect(apiCall.url.startsWith("https://www.zohoapis.com/books/v3")).toBe(true);
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

  it("fails loudly with Zoho's error when the refresh token itself is rejected, and calls no API", async () => {
    const fetch = makeFetch([], [() => jsonResponse(400, { error: "invalid_code" })]);
    const client = createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl });

    await expect(client.request("GET", "/invoices")).rejects.toThrow(/invalid_code/);
    expect(fetch.apiCalls()).toHaveLength(0);
  });
});

describe("createZohoBooksApi", () => {
  function makeApi(apiResponses: Array<() => Response>) {
    const fetch = makeFetch(apiResponses);
    const api = createZohoBooksApi(createZohoClient({ ...ENV, fetchImpl: fetch.fetchImpl }));
    return { api, fetch };
  }

  it("creates an invoice as draft then marks it sent, so payments can be applied", async () => {
    const { api, fetch } = makeApi([
      () => jsonResponse(200, { code: 0, invoice: { invoice_id: "inv-9" } }),
      () => jsonResponse(200, { code: 0 }),
    ]);

    const id = await api.createInvoice({ reference_number: "APALEO-BK-1" });

    expect(id).toBe("inv-9");
    const [create, sent] = fetch.apiCalls();
    expect(create.init.method).toBe("POST");
    expect(create.url).toContain("/invoices");
    expect(sent.init.method).toBe("POST");
    expect(sent.url).toContain("/invoices/inv-9/status/sent");
  });

  it("finds an invoice only on an exact reference match, never a contains-match neighbour", async () => {
    // Zoho's reference search is contains-based: asking for BK-1 returns
    // BK-10 too. Adopting the neighbour would hang one booking's money on
    // another booking's invoice.
    const { api } = makeApi([
      () =>
        jsonResponse(200, {
          code: 0,
          invoices: [{ invoice_id: "inv-10", reference_number: "APALEO-BK-10" }],
        }),
    ]);

    expect(await api.findInvoiceByReference("APALEO-BK-1")).toBeNull();
  });

  it("returns the exact match when Zoho holds one", async () => {
    const { api } = makeApi([
      () =>
        jsonResponse(200, {
          code: 0,
          invoices: [
            { invoice_id: "inv-10", reference_number: "APALEO-BK-10" },
            { invoice_id: "inv-1", reference_number: "APALEO-BK-1" },
          ],
        }),
    ]);

    expect(await api.findInvoiceByReference("APALEO-BK-1")).toBe("inv-1");
  });

  it("reports no invoice when the search comes back empty", async () => {
    const { api } = makeApi([() => jsonResponse(200, { code: 0, invoices: [] })]);
    expect(await api.findInvoiceByReference("APALEO-BK-1")).toBeNull();
  });

  it("updates an invoice in place with PUT", async () => {
    const { api, fetch } = makeApi([() => jsonResponse(200, { code: 0 })]);

    await api.updateInvoice("inv-1", { reason: "Folio update" });

    const call = fetch.apiCalls()[0];
    expect(call.init.method).toBe("PUT");
    expect(call.url).toContain("/invoices/inv-1");
    expect(JSON.parse(String(call.init.body))).toEqual({ reason: "Folio update" });
  });

  it("finds a payment only on an exact reference match, and null when none exists", async () => {
    const { api } = makeApi([
      () =>
        jsonResponse(200, {
          code: 0,
          customerpayments: [{ payment_id: "pay-10", reference_number: "track-10" }],
        }),
      () => jsonResponse(200, { code: 0, customerpayments: [] }),
    ]);

    // Contains-based search returns track-10 for track-1: not a match.
    expect(await api.findPaymentByReference("track-1")).toBeNull();
    expect(await api.findPaymentByReference("track-1")).toBeNull();
  });

  it("returns the exact payment match when Zoho holds one", async () => {
    const { api } = makeApi([
      () =>
        jsonResponse(200, {
          code: 0,
          customerpayments: [
            { payment_id: "pay-10", reference_number: "track-10" },
            { payment_id: "pay-1", reference_number: "track-1" },
          ],
        }),
    ]);

    expect(await api.findPaymentByReference("track-1")).toBe("pay-1");
  });

  it("markSent swallows the already-sent rejection instead of failing the push", async () => {
    const { api, fetch } = makeApi([
      () => jsonResponse(200, { code: 36006, message: "Invoice is already in sent status" }),
    ]);

    await expect(api.markSent("inv-1")).resolves.toBeUndefined();
    expect(fetch.apiCalls()[0].url).toContain("/invoices/inv-1/status/sent");
  });

  it("records a customer payment and returns its id", async () => {
    const { api, fetch } = makeApi([
      () => jsonResponse(200, { code: 0, payment: { payment_id: "pay-7" } }),
    ]);

    const id = await api.recordPayment({ amount: 13_500 });

    expect(id).toBe("pay-7");
    const call = fetch.apiCalls()[0];
    expect(call.init.method).toBe("POST");
    expect(call.url).toContain("/customerpayments");
  });
});
