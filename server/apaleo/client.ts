import "server-only";

/**
 * The only file that talks HTTP to Apaleo. Everything else in server/apaleo
 * goes through apaleo() below, so auth, retries and error shapes live in
 * exactly one place.
 */

const IDENTITY_URL = "https://identity.apaleo.com/connect/token";
const BASE_URL = "https://api.apaleo.com";

export const PROPERTY_ID = "UPNV";
export const CHANNEL_CODE = "Ibe";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  // Refresh 60s before expiry so a token never dies mid-request.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing CLIENT_ID / CLIENT_SECRET in .env");
  }

  const res = await fetch(IDENTITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Apaleo token request failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

export class ApaleoError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Apaleo request failed with ${status}`);
    this.name = "ApaleoError";
  }
}

type RequestOptions = {
  body?: unknown;
  /** Sent on POSTs so a retried request can never create a duplicate. */
  idempotencyKey?: string;
};

/**
 * Call the Apaleo API. Returns the parsed JSON body, or null on 204
 * (Apaleo's "valid request, empty result").
 * Retries once on 429 (honouring Retry-After) and once on 5xx.
 */
export async function apaleo<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });

    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get("retry-after") ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status >= 500 && attempt < 1) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    if (res.status === 204) return null;

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new ApaleoError(res.status, json);
    }
    return json as T;
  }
}
