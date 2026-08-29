import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composePartyInvite,
  sendPartyInvites,
  type PartyInviteFacts,
  type PartyInviteStore,
  type PendingPartyInvite,
} from "./partyInvite";

/**
 * Frozen suite for UNP-20 (docs/invite-a-guest-plan.md): the invite email.
 *
 * The composer is pure and its facts type carries no money at all, which is
 * the design that keeps amounts out of the email. The sender follows the
 * codebase's once-only pattern: claim before composing, release on failure,
 * so a settle that runs twice never mails twice. The store fake below is
 * dumb storage; every decision under test belongs to the module.
 */

function facts(overrides: Partial<PartyInviteFacts> = {}): PartyInviteFacts {
  return {
    leadFirstName: overrides.leadFirstName ?? "Achieng",
    leadLastName: overrides.leadLastName ?? "Odhiambo",
    village: overrides.village ?? "Mount Kenya",
    arrival: overrides.arrival ?? "2026-11-30",
    departure: overrides.departure ?? "2026-12-04",
    lodgeName: overrides.lodgeName ?? "Cedar Lodge",
    inviteUrl: overrides.inviteUrl ?? "https://unityparks.example/invite/tok-abc",
  };
}

describe("composePartyInvite", () => {
  it("tells the guest who invited them, where, and when", () => {
    const mail = composePartyInvite(facts());
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("Achieng");
      expect(body).toContain("Mount Kenya");
      expect(body).toContain("Cedar Lodge");
    }
    // Dates appear in some human form; pin the unambiguous parts.
    expect(mail.text).toMatch(/30/);
    expect(mail.text).toMatch(/November|Nov|11/);
  });

  it("carries the invite link in both bodies", () => {
    const mail = composePartyInvite(facts({ inviteUrl: "https://unityparks.example/invite/tok-xyz" }));
    expect(mail.html).toContain("https://unityparks.example/invite/tok-xyz");
    expect(mail.text).toContain("https://unityparks.example/invite/tok-xyz");
  });
});

/** In-memory store: rows plus a claimed set. Claiming is first-writer-wins,
 * exactly the semantics the DB stamp gives the real module. */
class FakeStore implements PartyInviteStore {
  claimed = new Set<string>();
  constructor(public pending: PendingPartyInvite[]) {}

  async loadPending(): Promise<PendingPartyInvite[]> {
    return this.pending.filter((p) => !this.claimed.has(p.inviteId)).map((p) => ({ ...p }));
  }
  async claim(inviteId: string): Promise<boolean> {
    if (this.claimed.has(inviteId)) return false;
    this.claimed.add(inviteId);
    return true;
  }
  async release(inviteId: string): Promise<void> {
    this.claimed.delete(inviteId);
  }
}

function pending(overrides: Partial<PendingPartyInvite> = {}): PendingPartyInvite {
  return {
    inviteId: overrides.inviteId ?? "inv-1",
    email: overrides.email ?? "party@example.com",
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

describe("sendPartyInvites", () => {
  it("mails each pending invite once, to its own address", async () => {
    const store = new FakeStore([
      pending({ inviteId: "inv-1", email: "one@example.com" }),
      pending({ inviteId: "inv-2", email: "two@example.com" }),
    ]);
    await sendPartyInvites(store, mailerOk);
    expect(sent.map((s) => s.to).sort()).toEqual(["one@example.com", "two@example.com"]);
  });

  it("a second run sends nothing more: the claim is the once-only", async () => {
    const store = new FakeStore([pending()]);
    await sendPartyInvites(store, mailerOk);
    await sendPartyInvites(store, mailerOk);
    expect(sent).toHaveLength(1);
  });

  it("releases the claim when the send fails, so a later run retries", async () => {
    const store = new FakeStore([pending()]);
    const failing = vi.fn(async () => ({ sent: false as const }));
    await sendPartyInvites(store, failing);
    // The failed row must be claimable again.
    await sendPartyInvites(store, mailerOk);
    expect(sent).toHaveLength(1);
  });

  it("a mailer that throws never breaks the caller, and the row stays retryable", async () => {
    const store = new FakeStore([pending()]);
    const exploding = vi.fn(async (): Promise<{ sent: boolean }> => {
      throw new Error("resend down");
    });
    await expect(sendPartyInvites(store, exploding)).resolves.not.toThrow();
    await sendPartyInvites(store, mailerOk);
    expect(sent).toHaveLength(1);
  });
});
