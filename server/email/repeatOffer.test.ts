import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeRepeatOffer,
  sendRepeatOfferNotices,
  type PendingOfferNotice,
  type RepeatOfferFacts,
  type RepeatOfferStore,
} from "./repeatOffer";

/**
 * Frozen suite for UNP-7 (docs/promo-codes-plan.md): the post-stay offer
 * email.
 *
 * The composer is pure and its facts type carries no booking reference,
 * which is the design that keeps the retired typed-secret out of inboxes:
 * the email says sign in, because the account IS the claim. The sender
 * claims the offerEmailSentAt stamp before composing and the stamp STAYS
 * on failure (spec section 9): this is a marketing email, a double send is
 * worse than a missed one, and the ops overview lists
 * stamped-but-possibly-unsent records for a manual decision. Deliberately
 * NOT the partyInvite release-on-failure pattern.
 */

function facts(overrides: Partial<RepeatOfferFacts> = {}): RepeatOfferFacts {
  return {
    firstName: overrides.firstName ?? "Achieng",
    perLodgeAmount: overrides.perLodgeAmount ?? 5000,
    maxLodges: overrides.maxLodges ?? 3,
    deadline: overrides.deadline ?? "2026-10-02",
    accountUrl: overrides.accountUrl ?? "https://unityparks.example/account",
  };
}

describe("composeRepeatOffer", () => {
  it("names the value and the per-lodge shape in both bodies", () => {
    const mail = composeRepeatOffer(facts());
    for (const body of [mail.html, mail.text]) {
      expect(body).toMatch(/5,000|5000/);
      expect(body).toMatch(/lodge/i);
    }
  });

  it("tells the guest the deadline in some human form", () => {
    const mail = composeRepeatOffer(facts({ deadline: "2026-10-02" }));
    expect(mail.text).toMatch(/October|Oct|10/);
    expect(mail.text).toMatch(/2/);
  });

  it("points at signing in to the account, the only claim there is", () => {
    const mail = composeRepeatOffer(facts());
    expect(mail.html).toContain("https://unityparks.example/account");
    expect(mail.text).toContain("https://unityparks.example/account");
  });

  it("never presents a booking reference as the way to claim", () => {
    // The typed-secret mechanic was retired on 2 Sep; an email teaching
    // guests to redeem by reference would resurrect it in inboxes.
    const mail = composeRepeatOffer(facts());
    expect(mail.text).not.toMatch(/booking reference/i);
    expect(mail.html).not.toMatch(/booking reference/i);
  });
});

/** In-memory store: rows plus a claimed set. Claiming is first-writer-wins,
 * exactly the semantics the DB stamp gives the real module. */
class FakeStore implements RepeatOfferStore {
  claimed = new Set<string>();
  constructor(public pending: PendingOfferNotice[]) {}

  async loadPending(): Promise<PendingOfferNotice[]> {
    return this.pending.filter((p) => !this.claimed.has(p.recordId)).map((p) => ({ ...p }));
  }
  async claim(recordId: string): Promise<boolean> {
    if (this.claimed.has(recordId)) return false;
    this.claimed.add(recordId);
    return true;
  }
  async release(recordId: string): Promise<void> {
    this.claimed.delete(recordId);
  }
}

function pendingNotice(overrides: Partial<PendingOfferNotice> = {}): PendingOfferNotice {
  return {
    recordId: overrides.recordId ?? "rec-1",
    email: overrides.email ?? "lead@example.com",
    facts: overrides.facts ?? facts(),
  };
}

const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
const mailerOk = vi.fn(async (args: { to: string; subject: string; html: string; text: string }) => {
  sent.push(args);
  return { sent: true as const };
});

beforeEach(() => {
  sent.length = 0;
  mailerOk.mockClear();
});

describe("sendRepeatOfferNotices", () => {
  it("mails each pending record once, to its lead guest", async () => {
    const store = new FakeStore([
      pendingNotice({ recordId: "rec-1", email: "one@example.com" }),
      pendingNotice({ recordId: "rec-2", email: "two@example.com" }),
    ]);
    await sendRepeatOfferNotices(store, mailerOk);
    expect(sent.map((s) => s.to).sort()).toEqual(["one@example.com", "two@example.com"]);
  });

  it("a second run sends nothing more: stamp-first, run-twice-safe", async () => {
    const store = new FakeStore([pendingNotice()]);
    await sendRepeatOfferNotices(store, mailerOk);
    await sendRepeatOfferNotices(store, mailerOk);
    expect(sent).toHaveLength(1);
  });

  it("a failed send leaves the stamp: no automatic retry, the ops overview owns the decision", async () => {
    // Spec section 9: "a failure leaves the stamp". A double marketing email
    // is worse than a missed one, so recovery is a human reading the
    // stamped-but-possibly-unsent list, never a blind re-send.
    const store = new FakeStore([pendingNotice()]);
    const failing = vi.fn(async () => ({ sent: false as const }));
    await sendRepeatOfferNotices(store, failing);
    await sendRepeatOfferNotices(store, mailerOk);
    expect(sent).toHaveLength(0);
    expect(store.claimed.has("rec-1")).toBe(true);
  });

  it("a mailer that throws never breaks the caller, and the stamp stays", async () => {
    const store = new FakeStore([pendingNotice()]);
    const exploding = vi.fn(async (): Promise<{ sent: boolean }> => {
      throw new Error("resend down");
    });
    await expect(sendRepeatOfferNotices(store, exploding)).resolves.not.toThrow();
    await sendRepeatOfferNotices(store, mailerOk);
    expect(sent).toHaveLength(0);
    expect(store.claimed.has("rec-1")).toBe(true);
  });
});
