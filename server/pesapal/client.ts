import "server-only";

/**
 * The only file that talks HTTP to Pesapal (API 3.0, JSON). Everything else
 * in server/pesapal goes through pesapal() below, so auth, error shapes and
 * the sandbox/live switch live in exactly one place. Mirrors the Apaleo
 * client on purpose: same token-cache pattern, same single-wrapper rule.
 *
 * Quirk to know: Pesapal often answers HTTP 200 with an `error` object in
 * the body (auth failure, unpaid order, rate limit). The wrapper treats a
 * non-null body.error as a failure; callers that expect a specific error
 * code (e.g. "payment_details_not_found" meaning "not paid yet") catch
 * PesapalError and inspect `code`.
 */

const BASE_URL =
  process.env.PESAPAL_BASE_URL ?? "https://cybqa.pesapal.com/pesapalv3";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  // Refresh 60s before expiry so a token never dies mid-request. Docs say
  // 5 minutes; the sandbox currently issues 60. We trust the expiryDate the
  // response carries rather than either number.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new Error("Missing PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET in .env");
  }

  const res = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as {
    token?: string;
    expiryDate?: string;
    error?: { code?: string; message?: string } | null;
  } | null;

  if (!res.ok || !body?.token || body.error) {
    throw new PesapalError(res.status, body, "Pesapal token request failed");
  }

  const expiresAt = Date.parse(body.expiryDate ?? "");
  cachedToken = {
    value: body.token,
    // A malformed expiryDate falls back to the documented 5 minutes.
    expiresAt: Number.isNaN(expiresAt) ? Date.now() + 5 * 60_000 : expiresAt,
  };
  return cachedToken.value;
}

export class PesapalError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Pesapal request failed with ${status}`);
    this.name = "PesapalError";
  }

  /** Pesapal's machine-readable error code, e.g. "payment_details_not_found". */
  get code(): string | null {
    const err = (this.body as { error?: { code?: string } } | null)?.error;
    return err?.code ?? null;
  }
}

export async function pesapal<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown } = {},
): Promise<T> {
  const token = await getToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new PesapalError(res.status, text, "Pesapal returned non-JSON");
  }

  // Pesapal's error field is unreliable in shape: absent on some successes,
  // null on others, and - observed live on GetTransactionStatus for a FAILED
  // payment - present but hollow ({ error_type: null, code: null, message:
  // null }). Only a populated error object means the request itself failed.
  const errorField = (json as {
    error?: { error_type?: unknown; code?: unknown; message?: unknown } | null;
  } | null)?.error;
  const failed =
    !!errorField &&
    (errorField.error_type != null || errorField.code != null || errorField.message != null);
  if (!res.ok || failed) {
    throw new PesapalError(res.status, json);
  }
  return json as T;
}
