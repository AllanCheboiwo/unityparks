import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

const config = {
  windowMs: 60_000,
  maxPerWindow: 10,
  failStreakLimit: 15,
  cooldownMs: 600_000,
};

describe("createRateLimiter", () => {
  it("allows up to maxPerWindow requests then refuses", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 10; i++) {
      expect(limiter.check("a", 1000).allowed).toBe(true);
    }
    const refused = limiter.check("a", 1000);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBe(60);
  });

  it("resets the count when the window rolls over", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 11; i++) limiter.check("a", 1000);
    expect(limiter.check("a", 1000 + 60_000).allowed).toBe(true);
  });

  it("keys are independent", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 11; i++) limiter.check("a", 1000);
    expect(limiter.check("b", 1000).allowed).toBe(true);
  });

  it("cools down after failStreakLimit consecutive failures", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 15; i++) limiter.recordFailure("a", 1000);
    const refused = limiter.check("a", 2000);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBe(599);
  });

  it("a success resets the failure streak", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 14; i++) limiter.recordFailure("a", 1000);
    limiter.recordSuccess("a", 1000);
    for (let i = 0; i < 14; i++) limiter.recordFailure("a", 1000);
    expect(limiter.check("a", 1000).allowed).toBe(true);
  });

  it("the cooldown ends", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 15; i++) limiter.recordFailure("a", 1000);
    expect(limiter.check("a", 1000 + 600_000).allowed).toBe(true);
  });

  it("failures below the streak limit never cool down", () => {
    const limiter = createRateLimiter(config);
    for (let i = 0; i < 14; i++) limiter.recordFailure("a", 1000);
    expect(limiter.check("a", 1000).allowed).toBe(true);
  });
});
