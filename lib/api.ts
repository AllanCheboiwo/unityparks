"use client";

/** Tiny client for our own API routes - the storefront's only data source. */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; refused?: boolean; soldOut?: boolean };

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.reason ?? body.error ?? "Something went wrong.",
        refused: body.refused === true,
        soldOut: body.soldOut === true,
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the booking service." };
  }
}

/** 410 = the server-side basket timed out; the guest starts over. */
export function isExpired(result: { ok: boolean; status?: number }): boolean {
  return !result.ok && result.status === 410;
}
