"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import type { SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";

type KnownUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type EmailGate = { email: string; status: "none" | "active" | "unknown" };

const inputClass =
  "mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40";
const labelClass = "text-xs font-medium text-foreground/60 uppercase tracking-wide";

/**
 * The Center Parcs details step: an email-first gate card ("Have an account
 * with us?"), then the lead booker form, then account creation as a
 * side-effect of booking. The gate card lives OUTSIDE the main form element
 * so pressing Enter on a password can never submit the booking as a guest.
 */
export function DetailsClient({ initialUser }: { initialUser: KnownUser | null }) {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");

  // Who we know the guest to be: from the cookie (server prefill) or from
  // an inline sign-in at the gate card.
  const [knownUser, setKnownUser] = useState<KnownUser | null>(initialUser);

  const [form, setForm] = useState({
    title: "",
    firstName: initialUser?.firstName ?? "",
    lastName: initialUser?.lastName ?? "",
    email: initialUser?.email ?? "",
    phone: initialUser?.phone ?? "",
    dateOfBirth: "",
    vehiclePlate: "",
  });
  const [marketingEmail, setMarketingEmail] = useState(false);
  const [marketingSms, setMarketingSms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // The email gate (signed-out guests only). null = not checked yet.
  const [gate, setGate] = useState<EmailGate | null>(null);
  const [checking, setChecking] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  // Inline sign-in, shown when the gate finds an existing account.
  const [signinPassword, setSigninPassword] = useState("");
  const [signinBusy, setSigninBusy] = useState(false);
  const [signinError, setSigninError] = useState<string | null>(null);
  const [declinedSignIn, setDeclinedSignIn] = useState(false);

  // "Create my Unity Parks account", pre-checked like Center Parcs.
  const [createAccount, setCreateAccount] = useState(true);
  const [newPassword, setNewPassword] = useState("");

  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (s.ok) setSummary(s.data);
    })();
  }, [sessionId]);

  if (!sessionId || expired) return <ExpiredNotice />;

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // The lead form unlocks once we know who is booking: a signed-in user, a
  // checked email, or a check that failed (never block the funnel on it).
  const formUnlocked = knownUser !== null || gate !== null;

  async function checkEmail() {
    const email = form.email.trim();
    if (!email.includes("@")) {
      setGateError("Please enter a valid email address.");
      return;
    }
    setChecking(true);
    setGateError(null);
    const result = await apiFetch<{ email: string; status: "none" | "active" }>(
      `/api/auth/email-status`,
      { method: "POST", body: JSON.stringify({ email }) },
    );
    setChecking(false);
    if (!result.ok) {
      // The check is advisory: on failure, carry on as a plain guest.
      setGate({ email, status: "unknown" });
      return;
    }
    // Bind the card to the exact value that was checked.
    setForm((f) => ({ ...f, email: result.data.email }));
    setGate({ email: result.data.email, status: result.data.status });
  }

  function changeEmail() {
    setGate(null);
    setDeclinedSignIn(false);
    setSigninPassword("");
    setSigninError(null);
  }

  async function inlineSignIn() {
    if (!gate || !signinPassword) return;
    setSigninBusy(true);
    setSigninError(null);
    const result = await apiFetch<KnownUser>(`/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: gate.email, password: signinPassword, sessionId }),
    });
    setSigninBusy(false);
    if (!result.ok) {
      setSigninError(result.error);
      return;
    }
    const u = result.data;
    setKnownUser(u);
    // Prefill only what the guest has not already typed.
    setForm((f) => ({
      ...f,
      firstName: f.firstName || u.firstName,
      lastName: f.lastName || u.lastName,
      email: u.email,
      phone: f.phone || (u.phone ?? ""),
    }));
    // Header chip appears without leaving the page.
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const wantsAccount =
      !knownUser && gate?.status === "none" && createAccount && newPassword.length >= 8;
    const result = await apiFetch<{ ok: boolean; accountCreated: boolean }>(
      `/api/session/${sessionId}/details`,
      {
        method: "POST",
        body: JSON.stringify({
          ...form,
          title: form.title || undefined,
          vehiclePlate: form.vehiclePlate.trim() || undefined,
          marketingEmail,
          marketingSms,
          termsAccepted,
          password: wantsAccount ? newPassword : undefined,
        }),
      },
    );
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      // The email grew an account between the check and the submit: flip
      // into the sign-in card, keeping everything the guest typed.
      if (result.emailTaken) {
        setGate({ email: form.email.trim().toLowerCase(), status: "active" });
        setDeclinedSignIn(false);
        setSigninError(result.error);
      } else {
        setError(result.error);
      }
      setBusy(false);
      return;
    }
    router.push(`/checkout/guests?session=${sessionId}`);
    // After the navigation so the header chip re-renders on the next page.
    if (result.data.accountCreated) router.refresh();
  }

  const showGate = !knownUser;
  const showSignInPanel =
    gate?.status === "active" && !knownUser && !declinedSignIn;
  const showCreateAccount = !knownUser && gate?.status === "none";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Stepper current="Your Details" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl text-forest">
            Your <em>details</em>
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            Lead booker details for the booking.
          </p>

          {knownUser && (
            <p className="mt-6 rounded-lg bg-forest/5 ring-1 ring-forest/15 px-4 py-3 text-sm text-forest">
              Booking as <span className="font-semibold">{knownUser.email}</span>. Your
              details are filled in below.
            </p>
          )}

          {showGate && (
            <div className="mt-6 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
              <p className="font-display text-lg text-forest">Have an account with us?</p>
              {!gate ? (
                <>
                  <p className="mt-1 text-sm text-foreground/60">
                    Enter your email address and we&apos;ll check.
                  </p>
                  <label className="block mt-3">
                    <span className={labelClass}>Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={update("email")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          checkEmail();
                        }
                      }}
                      className={inputClass}
                      placeholder="you@example.com"
                      autoFocus
                    />
                  </label>
                  {gateError && (
                    <p className="mt-2 text-sm text-red-700">{gateError}</p>
                  )}
                  <button
                    type="button"
                    onClick={checkEmail}
                    disabled={checking}
                    className="mt-3 rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
                  >
                    {checking ? "Checking…" : "Continue"}
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground/80">{gate.email}</span>
                    <button
                      type="button"
                      onClick={changeEmail}
                      className="text-sm text-forest underline underline-offset-2"
                    >
                      Change
                    </button>
                  </div>

                  {showSignInPanel && (
                    <div className="mt-4 border-t border-forest/10 pt-4">
                      <p className="text-sm text-foreground/80">
                        Looks like you already have an account. Sign in and
                        we&apos;ll fill this in for you.
                      </p>
                      <label className="block mt-3">
                        <span className={labelClass}>Password</span>
                        <input
                          type="password"
                          value={signinPassword}
                          onChange={(e) => setSigninPassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              inlineSignIn();
                            }
                          }}
                          className={inputClass}
                        />
                      </label>
                      {signinError && (
                        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                          {signinError}
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-4">
                        <button
                          type="button"
                          onClick={inlineSignIn}
                          disabled={signinBusy}
                          className="rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
                        >
                          {signinBusy ? "Signing in…" : "Sign in"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeclinedSignIn(true)}
                          className="text-sm text-foreground/60 underline underline-offset-2"
                        >
                          Not now, continue as guest
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-foreground/50">
                        Forgotten your password? Password reset is not part of
                        this demo.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 grid gap-5">
            <fieldset
              disabled={!formUnlocked}
              className={`grid gap-5 border-0 p-0 m-0 ${formUnlocked ? "" : "opacity-40"}`}
            >
              <label className="max-w-[10rem]">
                <span className={labelClass}>Title</span>
                <select
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Select title</option>
                  <option>Mr</option>
                  <option>Mrs</option>
                  <option>Ms</option>
                  <option>Miss</option>
                  <option>Dr</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label>
                  <span className={labelClass}>First name</span>
                  <input required value={form.firstName} onChange={update("firstName")} className={inputClass} />
                </label>
                <label>
                  <span className={labelClass}>Last name</span>
                  <input required value={form.lastName} onChange={update("lastName")} className={inputClass} />
                </label>
              </div>

              <label>
                <span className={labelClass}>Date of birth</span>
                <input
                  type="date"
                  required
                  value={form.dateOfBirth}
                  onChange={update("dateOfBirth")}
                  className={inputClass}
                />
                <span className="mt-1 block text-xs text-foreground/50">
                  The lead booker must be over 18 at the time of arrival.
                </span>
              </label>

              {knownUser && (
                <label>
                  <span className={labelClass}>
                    Email <span className="normal-case font-normal">(lead guest)</span>
                  </span>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={update("email")}
                    className={inputClass}
                  />
                </label>
              )}

              <label>
                <span className={labelClass}>Mobile phone</span>
                <input
                  type="tel"
                  required
                  minLength={7}
                  value={form.phone}
                  onChange={update("phone")}
                  className={inputClass}
                  placeholder="+254 7xx xxx xxx"
                />
              </label>

              <label>
                <span className={labelClass}>
                  Vehicle number plate <span className="normal-case font-normal">(optional)</span>
                </span>
                <input
                  value={form.vehiclePlate}
                  onChange={update("vehiclePlate")}
                  className={`${inputClass} uppercase`}
                  placeholder="KDA 123A"
                />
                <span className="mt-1 block text-xs text-foreground/50">
                  Register your plate and the gate opens automatically when you
                  arrive. No queuing.
                </span>
              </label>

              {showCreateAccount && (
                <div className="rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={createAccount}
                      onChange={(e) => setCreateAccount(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-forest"
                    />
                    <span>
                      <span className="font-display text-lg text-forest block">
                        Create my Unity Parks account
                      </span>
                      <span className="text-sm text-foreground/60 block mt-0.5">
                        We&apos;ll set it up as part of this booking, so you can
                        see and manage your breaks any time.
                      </span>
                    </span>
                  </label>
                  {createAccount && (
                    <label className="block mt-4">
                      <span className={labelClass}>Choose a password</span>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={inputClass}
                      />
                      <span className="mt-1 block text-xs text-foreground/50">
                        At least 8 characters.
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div className="rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5 text-sm text-foreground/70">
                <p>
                  To hear about the latest Unity Parks news, including repeat
                  guest offers, tick below.
                </p>
                <div className="mt-3 flex gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={marketingEmail}
                      onChange={(e) => setMarketingEmail(e.target.checked)}
                      className="h-4 w-4 accent-forest"
                    />
                    Email
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={marketingSms}
                      onChange={(e) => setMarketingSms(e.target.checked)}
                      className="h-4 w-4 accent-forest"
                    />
                    SMS
                  </label>
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-foreground/70">
                <input
                  type="checkbox"
                  required
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-forest"
                />
                <span>
                  I have read and accept the booking terms and conditions and
                  the safety information for my break.
                </span>
              </label>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-forest text-white px-6 py-3 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
              >
                {busy ? "Saving…" : "Continue"}
              </button>
            </fieldset>
          </form>
        </div>

        {summary && (
          <aside className="mt-8 lg:mt-0 lg:sticky lg:top-20">
            <BookingSummary summary={summary} />
          </aside>
        )}
      </div>
    </div>
  );
}
