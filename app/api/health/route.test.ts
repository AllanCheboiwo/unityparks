import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UNP-33 (docs/observability-plan.md): the route Railway polls. The
 * guarantee is 200 while Postgres answers and 503 the moment it does not,
 * with nothing cached in between. The fake is dumb storage for one
 * outcome; the route decides the status.
 */

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(async (): Promise<unknown> => [{ "?column?": 1 }]),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: db }));

import { GET } from "./route";

beforeEach(() => {
  db.$queryRaw.mockReset();
  db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
});

describe("GET /api/health", () => {
  it("answers 200 while the database responds", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers 503 when the database query fails", async () => {
    db.$queryRaw.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("is never cached, so a recovered database is seen on the next poll", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
