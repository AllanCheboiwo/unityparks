/**
 * The only file that talks HTTP to Zoho Books. Same single-wrapper rule as
 * the Apaleo and Pesapal clients: auth, error shapes and endpoints live in
 * exactly one place. No "server-only" marker here, unlike its siblings:
 * the frozen suite imports this file directly under vitest, and nothing
 * client-side ever imports server/zoho.
 *
 * Endpoints are pinned to the US data center on purpose. The org lives
 * there, and an earlier Canadian-DC account was abandoned for exactly the
 * confusion a silent wrong-DC default would recreate.
 *
 * Quirk to know: Zoho often answers HTTP 200 with a non-zero `code` in the
 * body (validation failures, the mandatory update reason). The wrapper
 * treats any non-zero code as a failure and surfaces Zoho's message.
 */

const TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const API_BASE = "https://www.zohoapis.com/books/v3";

export type ZohoClientConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  /** Injected by tests; production uses global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
};

export type ZohoClient = {
  request<T = unknown>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T>;
};

type ZohoBody = { code?: number; message?: string } & Record<string, unknown>;

export function createZohoClient(config: ZohoClientConfig): ZohoClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  // Per-client cache, refreshed 60s before expiry so a token never dies
  // mid-request (the Apaleo/Pesapal pattern).
  let cached: { value: string; expiresAt: number } | null = null;

  async function getToken(force: boolean): Promise<string> {
    if (!force && cached && Date.now() < cached.expiresAt - 60_000) {
      return cached.value;
    }
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error?: string }
      | null;
    if (!res.ok || !body?.access_token) {
      // A revoked or mistyped refresh token lands here; the message carries
      // Zoho's error so it reads clearly as a lastError on the ops page.
      throw new Error(`Zoho token refresh failed (${res.status}): ${JSON.stringify(body)}`);
    }
    cached = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return cached.value;
  }

  async function call(
    method: string,
    path: string,
    body: unknown,
    token: string,
  ): Promise<Response> {
    const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}organization_id=${config.orgId}`;
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  return {
    async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
      let res = await call(method, path, body, await getToken(false));
      if (res.status === 401) {
        // The cached access token aged out: refresh once and retry. A second
        // 401 means the refresh token itself is dead; fail loudly.
        res = await call(method, path, body, await getToken(true));
      }
      const parsed = (await res.json().catch(() => null)) as ZohoBody | null;
      if (res.status === 401) {
        throw new Error(`Zoho request failed with 401: ${parsed?.message ?? "unauthorized"}`);
      }
      if (parsed && typeof parsed.code === "number" && parsed.code !== 0) {
        throw new Error(`Zoho rejected the request (code ${parsed.code}): ${parsed.message}`);
      }
      if (!res.ok) {
        throw new Error(`Zoho request failed with ${res.status}`);
      }
      return parsed as T;
    },
  };
}

/**
 * The Books-level operations the pusher needs, on top of the raw client.
 * Sequencing knowledge lives here: a created invoice starts as draft and
 * must be marked sent before payments can be applied (verified live on the
 * org, 26 Aug 2026).
 */
export function createZohoBooksApi(client: ZohoClient) {
  return {
    /**
     * Exact-match lookup by booking reference. Zoho's search is
     * contains-based (BK-1 also returns BK-10), and adopting a neighbour
     * would hang one booking's money on another booking's invoice.
     */
    async findInvoiceByReference(reference: string): Promise<string | null> {
      const data = await client.request<{
        invoices?: Array<{ invoice_id: string; reference_number: string }>;
      }>("GET", `/invoices?reference_number=${encodeURIComponent(reference)}`);
      const exact = data.invoices?.find((i) => i.reference_number === reference);
      return exact?.invoice_id ?? null;
    },

    /** Create as draft, mark sent, return the id. */
    async createInvoice(payload: unknown): Promise<string> {
      const data = await client.request<{ invoice: { invoice_id: string } }>(
        "POST",
        "/invoices",
        payload,
      );
      const id = data.invoice.invoice_id;
      await client.request("POST", `/invoices/${id}/status/sent`);
      return id;
    },

    async updateInvoice(invoiceId: string, payload: unknown): Promise<void> {
      await client.request("PUT", `/invoices/${invoiceId}`, payload);
    },

    async recordPayment(payload: unknown): Promise<string> {
      const data = await client.request<{ payment: { payment_id: string } }>(
        "POST",
        "/customerpayments",
        payload,
      );
      return data.payment.payment_id;
    },
  };
}
