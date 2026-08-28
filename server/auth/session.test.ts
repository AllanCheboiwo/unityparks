import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frozen suite for UNP-19 (docs/mandatory-accounts-plan.md): "Keep me signed
 * in" controls the KIND of cookie, not its length. Unticked means a session
 * cookie - no expiry attribute, gone when the browser closes - with a short
 * server-side cap on the DB row. Ticked means a persistent cookie about six
 * months out. The cookie jar is this module's output device, so the tests
 * read what was set on it; the fakes below store and answer, nothing more.
 */

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
}));

const db = vi.hoisted(() => ({
  authSession: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    findUnique: vi.fn(async () => null),
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({ prisma: db }));

import { createAuthSession } from "./session";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function cookieCall() {
  expect(jar.set).toHaveBeenCalledTimes(1);
  const [name, token, options] = jar.set.mock.calls[0];
  return { name, token, options: options as Record<string, unknown> };
}

function createdRow() {
  expect(db.authSession.create).toHaveBeenCalledTimes(1);
  return db.authSession.create.mock.calls[0][0].data as {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

beforeEach(() => {
  jar.set.mockClear();
  db.authSession.create.mockClear();
});

describe("createAuthSession, keep-me-signed-in unticked", () => {
  it("sets a session cookie: no expiry attribute at all", async () => {
    await createAuthSession("user-1", false);
    const { options } = cookieCall();
    expect(options.expires).toBeUndefined();
    expect(options.maxAge).toBeUndefined();
  });

  it("caps the DB row at about a day, a backstop rather than a promise", async () => {
    const before = Date.now();
    await createAuthSession("user-1", false);
    const row = createdRow();
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(1 * HOUR);
    expect(ttl).toBeLessThanOrEqual(2 * DAY);
  });

  it("still stores the cookie's bearer token as the row id, so the session works until the browser closes", async () => {
    await createAuthSession("user-1", false);
    expect(cookieCall().token).toBe(createdRow().id);
  });
});

describe("createAuthSession, keep-me-signed-in ticked", () => {
  it("sets a persistent cookie about six months out", async () => {
    const before = Date.now();
    await createAuthSession("user-1", true);
    const expires = cookieCall().options.expires as Date;
    const ttl = expires.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(150 * DAY);
    expect(ttl).toBeLessThanOrEqual(200 * DAY);
  });

  it("keeps the DB row alive at least as long as the cookie", async () => {
    // The guarantee is no dead-cookie period: the browser must never hold a
    // cookie the server has already expired. Exact equality would be a
    // change detector - server-side slack beyond the cookie is invisible.
    await createAuthSession("user-1", true);
    const expires = cookieCall().options.expires as Date;
    expect(createdRow().expiresAt.getTime()).toBeGreaterThanOrEqual(expires.getTime());
  });
});

describe("createAuthSession, both kinds", () => {
  it("keeps the cookie httpOnly, out of script reach", async () => {
    await createAuthSession("user-1", false);
    expect(cookieCall().options.httpOnly).toBe(true);
    jar.set.mockClear();
    db.authSession.create.mockClear();
    await createAuthSession("user-1", true);
    expect(cookieCall().options.httpOnly).toBe(true);
  });
});
