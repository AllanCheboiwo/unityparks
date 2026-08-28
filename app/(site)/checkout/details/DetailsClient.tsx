"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { adultAtArrival, isUsablePhone } from "@/lib/guestRules";
import type { SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon, EyeIcon, EyeOffIcon, TickIcon } from "../icons";

type KnownUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  // Profile fields arrive empty ("" from the server page, null from the
  // login API) for accounts created before they existed.
  title?: string | null;
  dateOfBirth?: string | null;
  marketingEmail?: boolean;
  marketingSms?: boolean;
};

// Every ITU calling code, ISO alpha-3 labelled, alphabetical. The select is
// keyed by label (unique) rather than code: many countries share a code
// (+1, +44, +7...) and duplicate <option> values make a controlled select
// snap to the first match.
const PHONE_CODES = [
  { label: "AFG", code: "+93" }, { label: "AGO", code: "+244" }, { label: "AIA", code: "+1" },
  { label: "ALB", code: "+355" }, { label: "AND", code: "+376" }, { label: "ARE", code: "+971" },
  { label: "ARG", code: "+54" }, { label: "ARM", code: "+374" }, { label: "ASM", code: "+1" },
  { label: "ATG", code: "+1" }, { label: "AUS", code: "+61" }, { label: "AUT", code: "+43" },
  { label: "AZE", code: "+994" }, { label: "BDI", code: "+257" }, { label: "BEL", code: "+32" },
  { label: "BEN", code: "+229" }, { label: "BES", code: "+599" }, { label: "BFA", code: "+226" },
  { label: "BGD", code: "+880" }, { label: "BGR", code: "+359" }, { label: "BHR", code: "+973" },
  { label: "BHS", code: "+1" }, { label: "BIH", code: "+387" }, { label: "BLM", code: "+590" },
  { label: "BLR", code: "+375" }, { label: "BLZ", code: "+501" }, { label: "BMU", code: "+1" },
  { label: "BOL", code: "+591" }, { label: "BRA", code: "+55" }, { label: "BRB", code: "+1" },
  { label: "BRN", code: "+673" }, { label: "BTN", code: "+975" }, { label: "BWA", code: "+267" },
  { label: "CAF", code: "+236" }, { label: "CAN", code: "+1" }, { label: "CHE", code: "+41" },
  { label: "CHL", code: "+56" }, { label: "CHN", code: "+86" }, { label: "CIV", code: "+225" },
  { label: "CMR", code: "+237" }, { label: "COD", code: "+243" }, { label: "COG", code: "+242" },
  { label: "COK", code: "+682" }, { label: "COL", code: "+57" }, { label: "COM", code: "+269" },
  { label: "CPV", code: "+238" }, { label: "CRI", code: "+506" }, { label: "CUB", code: "+53" },
  { label: "CUW", code: "+599" }, { label: "CYM", code: "+1" }, { label: "CYP", code: "+357" },
  { label: "CZE", code: "+420" }, { label: "DEU", code: "+49" }, { label: "DJI", code: "+253" },
  { label: "DMA", code: "+1" }, { label: "DNK", code: "+45" }, { label: "DOM", code: "+1" },
  { label: "DZA", code: "+213" }, { label: "ECU", code: "+593" }, { label: "EGY", code: "+20" },
  { label: "ERI", code: "+291" }, { label: "ESP", code: "+34" }, { label: "EST", code: "+372" },
  { label: "ETH", code: "+251" }, { label: "FIN", code: "+358" }, { label: "FJI", code: "+679" },
  { label: "FLK", code: "+500" }, { label: "FRA", code: "+33" }, { label: "FRO", code: "+298" },
  { label: "FSM", code: "+691" }, { label: "GAB", code: "+241" }, { label: "GBR", code: "+44" },
  { label: "GEO", code: "+995" }, { label: "GGY", code: "+44" }, { label: "GHA", code: "+233" },
  { label: "GIB", code: "+350" }, { label: "GIN", code: "+224" }, { label: "GLP", code: "+590" },
  { label: "GMB", code: "+220" }, { label: "GNB", code: "+245" }, { label: "GNQ", code: "+240" },
  { label: "GRC", code: "+30" }, { label: "GRD", code: "+1" }, { label: "GRL", code: "+299" },
  { label: "GTM", code: "+502" }, { label: "GUF", code: "+594" }, { label: "GUM", code: "+1" },
  { label: "GUY", code: "+592" }, { label: "HKG", code: "+852" }, { label: "HND", code: "+504" },
  { label: "HRV", code: "+385" }, { label: "HTI", code: "+509" }, { label: "HUN", code: "+36" },
  { label: "IDN", code: "+62" }, { label: "IMN", code: "+44" }, { label: "IND", code: "+91" },
  { label: "IRL", code: "+353" }, { label: "IRN", code: "+98" }, { label: "IRQ", code: "+964" },
  { label: "ISL", code: "+354" }, { label: "ISR", code: "+972" }, { label: "ITA", code: "+39" },
  { label: "JAM", code: "+1" }, { label: "JEY", code: "+44" }, { label: "JOR", code: "+962" },
  { label: "JPN", code: "+81" }, { label: "KAZ", code: "+7" }, { label: "KEN", code: "+254" },
  { label: "KGZ", code: "+996" }, { label: "KHM", code: "+855" }, { label: "KIR", code: "+686" },
  { label: "KNA", code: "+1" }, { label: "KOR", code: "+82" }, { label: "KWT", code: "+965" },
  { label: "LAO", code: "+856" }, { label: "LBN", code: "+961" }, { label: "LBR", code: "+231" },
  { label: "LBY", code: "+218" }, { label: "LCA", code: "+1" }, { label: "LIE", code: "+423" },
  { label: "LKA", code: "+94" }, { label: "LSO", code: "+266" }, { label: "LTU", code: "+370" },
  { label: "LUX", code: "+352" }, { label: "LVA", code: "+371" }, { label: "MAC", code: "+853" },
  { label: "MAF", code: "+590" }, { label: "MAR", code: "+212" }, { label: "MCO", code: "+377" },
  { label: "MDA", code: "+373" }, { label: "MDG", code: "+261" }, { label: "MDV", code: "+960" },
  { label: "MEX", code: "+52" }, { label: "MHL", code: "+692" }, { label: "MKD", code: "+389" },
  { label: "MLI", code: "+223" }, { label: "MLT", code: "+356" }, { label: "MMR", code: "+95" },
  { label: "MNE", code: "+382" }, { label: "MNG", code: "+976" }, { label: "MNP", code: "+1" },
  { label: "MOZ", code: "+258" }, { label: "MRT", code: "+222" }, { label: "MSR", code: "+1" },
  { label: "MTQ", code: "+596" }, { label: "MUS", code: "+230" }, { label: "MWI", code: "+265" },
  { label: "MYS", code: "+60" }, { label: "MYT", code: "+262" }, { label: "NAM", code: "+264" },
  { label: "NCL", code: "+687" }, { label: "NER", code: "+227" }, { label: "NFK", code: "+672" },
  { label: "NGA", code: "+234" }, { label: "NIC", code: "+505" }, { label: "NIU", code: "+683" },
  { label: "NLD", code: "+31" }, { label: "NOR", code: "+47" }, { label: "NPL", code: "+977" },
  { label: "NRU", code: "+674" }, { label: "NZL", code: "+64" }, { label: "OMN", code: "+968" },
  { label: "PAK", code: "+92" }, { label: "PAN", code: "+507" }, { label: "PER", code: "+51" },
  { label: "PHL", code: "+63" }, { label: "PLW", code: "+680" }, { label: "PNG", code: "+675" },
  { label: "POL", code: "+48" }, { label: "PRI", code: "+1" }, { label: "PRK", code: "+850" },
  { label: "PRT", code: "+351" }, { label: "PRY", code: "+595" }, { label: "PSE", code: "+970" },
  { label: "PYF", code: "+689" }, { label: "QAT", code: "+974" }, { label: "REU", code: "+262" },
  { label: "ROU", code: "+40" }, { label: "RUS", code: "+7" }, { label: "RWA", code: "+250" },
  { label: "SAU", code: "+966" }, { label: "SDN", code: "+249" }, { label: "SEN", code: "+221" },
  { label: "SGP", code: "+65" }, { label: "SHN", code: "+290" }, { label: "SLB", code: "+677" },
  { label: "SLE", code: "+232" }, { label: "SLV", code: "+503" }, { label: "SMR", code: "+378" },
  { label: "SOM", code: "+252" }, { label: "SPM", code: "+508" }, { label: "SRB", code: "+381" },
  { label: "SSD", code: "+211" }, { label: "STP", code: "+239" }, { label: "SUR", code: "+597" },
  { label: "SVK", code: "+421" }, { label: "SVN", code: "+386" }, { label: "SWE", code: "+46" },
  { label: "SWZ", code: "+268" }, { label: "SXM", code: "+1" }, { label: "SYC", code: "+248" },
  { label: "SYR", code: "+963" }, { label: "TCA", code: "+1" }, { label: "TCD", code: "+235" },
  { label: "TGO", code: "+228" }, { label: "THA", code: "+66" }, { label: "TJK", code: "+992" },
  { label: "TKL", code: "+690" }, { label: "TKM", code: "+993" }, { label: "TLS", code: "+670" },
  { label: "TON", code: "+676" }, { label: "TTO", code: "+1" }, { label: "TUN", code: "+216" },
  { label: "TUR", code: "+90" }, { label: "TUV", code: "+688" }, { label: "TWN", code: "+886" },
  { label: "TZA", code: "+255" }, { label: "UGA", code: "+256" }, { label: "UKR", code: "+380" },
  { label: "URY", code: "+598" }, { label: "USA", code: "+1" }, { label: "UZB", code: "+998" },
  { label: "VAT", code: "+39" }, { label: "VCT", code: "+1" }, { label: "VEN", code: "+58" },
  { label: "VGB", code: "+1" }, { label: "VIR", code: "+1" }, { label: "VNM", code: "+84" },
  { label: "VUT", code: "+678" }, { label: "WLF", code: "+681" }, { label: "WSM", code: "+685" },
  { label: "XKX", code: "+383" }, { label: "YEM", code: "+967" }, { label: "ZAF", code: "+27" },
  { label: "ZMB", code: "+260" }, { label: "ZWE", code: "+263" },
];

const CODE_BY_LABEL = new Map(PHONE_CODES.map((c) => [c.label, c.code]));

// Shared codes prefill as the country a stored number most likely belongs to.
const CANONICAL_LABEL: Record<string, string> = {
  "+1": "USA", "+7": "RUS", "+39": "ITA", "+44": "GBR", "+47": "NOR",
  "+61": "AUS", "+212": "MAR", "+262": "REU", "+290": "SHN", "+358": "FIN",
  "+590": "GLP", "+599": "CUW", "+672": "NFK",
};

/** Split a stored phone ("+254717464236") back into dropdown + number for
 * prefill, longest code first so "+25..." never steals "+254...".
 * Unrecognised values keep Kenya and land whole in the number box. */
function splitPhone(stored: string): { country: string; number: string } {
  const compact = stored.replace(/[\s-]/g, "");
  const codes = [...new Set(PHONE_CODES.map((c) => c.code))].sort(
    (a, b) => b.length - a.length,
  );
  const code = codes.find((c) => compact.startsWith(c));
  if (!code) return { country: "KEN", number: compact.replace(/^\+/, "") };
  const country =
    CANONICAL_LABEL[code] ?? PHONE_CODES.find((c) => c.code === code)!.label;
  return { country, number: compact.slice(code.length) };
}

/** One E.164-ish string for storage: code + digits, local leading zero
 * dropped ("0717..." dialled from abroad needs "+254717..."). */
function joinPhone(country: string, number: string): string {
  const code = CODE_BY_LABEL.get(country) ?? "+254";
  return `${code}${number.replace(/\D/g, "").replace(/^0+/, "")}`;
}

type EmailGate = { email: string; status: "none" | "active" | "unknown" };

const inputClass =
  "mt-1.5 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:border-navy focus:ring-2 focus:ring-navy/25";
const labelClass = "text-sm font-semibold text-foreground";
const cardClass = "rounded-lg bg-white border border-line p-6";
const cardTitleClass = "text-xl font-bold text-ink";
const errorClass =
  "flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]";

/** Index of the last step, the one holding the terms box and Continue. */
const LAST_STEP = 1;

/** The asterisk after a required field's label, explained once above the
 * form. Decoration only: the inputs carry their own required semantics. */
function RequiredMark() {
  return (
    <span aria-hidden className="text-foreground/50">
      {" "}
      *
    </span>
  );
}

/** The message under a field that failed its step's check. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="mt-1 flex items-start gap-1.5 text-sm text-[#b3261e]">
      <AlertIcon />
      {message}
    </span>
  );
}

/**
 * How a section is being shown. "plain" is the whole form open at once, for
 * a guest who is reviewing prefilled details rather than entering them.
 */
type SectionState = "plain" | "open" | "done" | "upcoming";

/**
 * One numbered section of the form. In "done" and "upcoming" it renders NO
 * fields at all, which is the point: a disabled input is skipped by autofill
 * and by screen readers, so an unreached step is better left unrendered than
 * rendered dead. Whichever step is open has all of its fields live, so a
 * browser autofilling a whole step in one go still works.
 */
function Section({
  index,
  title,
  subtitle,
  state,
  summary,
  onEdit,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  state: SectionState;
  /** The one-line recap shown in place of the fields once the step is done. */
  summary?: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  if (state === "plain") {
    return (
      <div className={cardClass}>
        <p className={cardTitleClass}>{title}</p>
        {subtitle && <p className="mt-1 text-sm text-foreground/60">{subtitle}</p>}
        <div className="mt-4 grid gap-5">{children}</div>
      </div>
    );
  }

  const upcoming = state === "upcoming";
  return (
    <div
      id={`details-step-${index}`}
      className={`rounded-lg border p-6 ${
        upcoming ? "border-line bg-mist/60" : "border-line bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            state === "done"
              ? "bg-olive text-white"
              : upcoming
                ? "bg-line text-foreground/50"
                : "bg-navy text-white"
          }`}
        >
          {state === "done" ? <TickIcon className="h-3.5 w-3.5" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className={`${cardTitleClass} ${upcoming ? "text-foreground/50" : ""}`}>
              {title}
            </p>
            {state === "done" && (
              <button
                type="button"
                onClick={onEdit}
                className="shrink-0 text-sm text-navy underline underline-offset-2"
              >
                Edit
              </button>
            )}
          </div>
          {state === "done" && summary && (
            <p className="mt-1 text-sm text-foreground/70">{summary}</p>
          )}
          {state === "open" && subtitle && (
            <p className="mt-1 text-sm text-foreground/60">{subtitle}</p>
          )}
        </div>
      </div>
      {state === "open" && <div className="mt-5 grid gap-5">{children}</div>}
    </div>
  );
}

/**
 * The details step: an email-first gate card ("Have an account
 * with us?"), then the lead booker form, then account creation as a
 * side-effect of booking. The gate card lives OUTSIDE the main form element
 * so pressing Enter on a password can never submit the booking as a guest.
 *
 * A guest whose email turns out to be new fills the form in two numbered
 * steps, one open at a time (Center Parcs parity, and a long form is
 * punishing on a phone otherwise). Everyone else - signed in, prefilled from
 * an account, or an email check that failed - gets the whole form open,
 * because reviewing details is a different job from entering them and it is
 * worse when chopped up.
 */
export function DetailsClient({ initialUser }: { initialUser: KnownUser | null }) {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");

  // Who we know the guest to be: from the cookie (server prefill) or from
  // an inline sign-in at the gate card.
  const [knownUser, setKnownUser] = useState<KnownUser | null>(initialUser);

  const initialPhone = splitPhone(initialUser?.phone ?? "");
  const [form, setForm] = useState({
    title: initialUser?.title ?? "",
    firstName: initialUser?.firstName ?? "",
    lastName: initialUser?.lastName ?? "",
    email: initialUser?.email ?? "",
    phoneCountry: initialPhone.country,
    phoneNumber: initialPhone.number,
    dateOfBirth: initialUser?.dateOfBirth ?? "",
  });
  const [marketingEmail, setMarketingEmail] = useState(initialUser?.marketingEmail ?? false);
  const [marketingSms, setMarketingSms] = useState(initialUser?.marketingSms ?? false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // The email gate (signed-out guests only). null = not checked yet.
  const [gate, setGate] = useState<EmailGate | null>(null);
  const [checking, setChecking] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  // Inline sign-in, shown when the gate finds an existing account.
  const [signinPassword, setSigninPassword] = useState("");
  const [showSigninPassword, setShowSigninPassword] = useState(false);
  const [signinBusy, setSigninBusy] = useState(false);
  const [signinError, setSigninError] = useState<string | null>(null);
  const [signinRemember, setSigninRemember] = useState(false);

  // "Create my Unity Parks account", pre-checked by default.
  const [newPassword, setNewPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The phased form: which step is open, and how many are behind us. They
  // are separate because editing a finished step must not un-finish the ones
  // after it - re-locking the page under someone who came back to fix a typo
  // is the rudest thing this screen could do.
  const [openStep, setOpenStep] = useState(0);
  const [stepsDone, setStepsDone] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The referral code box lives on the pay step, next to the credit toggle
  // and the total it changes. This form deliberately omits referralCode from
  // its submit body: absent means "keep and revalidate whatever is stamped",
  // so a code a /r/ link left on the session survives this step untouched
  // and reaches the pay page with a fresh discount snapshot.

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (s.ok) setSummary(s.data);
    })();
  }, [sessionId]);

  // A finished step collapses from a screenful to one line, which yanks the
  // page up under the guest and can leave the newly opened step off-screen
  // below them. Put it back in view. Skipped on the first render, where
  // nothing has moved and step 0 is already where they are looking.
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    document
      .getElementById(`details-step-${openStep}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openStep]);

  if (!sessionId || expired) return <ExpiredNotice />;

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // The lead form unlocks once we know who is booking: a signed-in user, a
  // checked email, or a check that failed (never block the funnel on it).
  const formUnlocked = knownUser !== null || gate !== null;

  const showGate = !knownUser;
  const showSignInPanel = gate?.status === "active" && !knownUser;
  // "unknown" (the advisory check failed) gets the account card too: with
  // accounts mandatory there is no plain-guest path to fall back to, so we
  // collect a password regardless. If the email secretly has an account the
  // submit's emailTaken flip turns this card into sign-in.
  const showCreateAccount =
    !knownUser && (gate?.status === "none" || gate?.status === "unknown");
  // Who gets the phased form: an email we have never seen, so someone typing
  // all of this from scratch. Anyone else is reviewing rather than entering -
  // signed in, prefilled, or an email check that failed and left us unsure -
  // and gets the whole form open. Same condition as the account offer,
  // because it is the same person: a brand new guest.
  const phased = showCreateAccount;

  function stepState(index: number): SectionState {
    if (!phased) return "plain";
    if (index === openStep) return "open";
    return index < stepsDone ? "done" : "upcoming";
  }

  // What a finished step says in place of its fields: enough to recognise as
  // yours at a glance, and to notice a typo without pressing Edit.
  const aboutSummary = [
    [form.title, form.firstName, form.lastName].filter(Boolean).join(" "),
    joinPhone(form.phoneCountry, form.phoneNumber),
  ]
    .filter(Boolean)
    .join(" · ");

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
    setSigninPassword("");
    setSigninError(null);
  }

  async function inlineSignIn() {
    if (!gate || !signinPassword) return;
    setSigninBusy(true);
    setSigninError(null);
    const result = await apiFetch<KnownUser>(`/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({
        email: gate.email,
        password: signinPassword,
        sessionId,
        remember: signinRemember,
      }),
    });
    setSigninBusy(false);
    if (!result.ok) {
      setSigninError(result.error);
      return;
    }
    const u = result.data;
    setKnownUser(u);
    // Prefill only what the guest has not already typed.
    const savedPhone = splitPhone(u.phone ?? "");
    setForm((f) => ({
      ...f,
      title: f.title || (u.title ?? ""),
      firstName: f.firstName || u.firstName,
      lastName: f.lastName || u.lastName,
      email: u.email,
      phoneCountry: f.phoneNumber ? f.phoneCountry : savedPhone.country,
      phoneNumber: f.phoneNumber || savedPhone.number,
      dateOfBirth: f.dateOfBirth || (u.dateOfBirth ?? ""),
    }));
    // Consent is account state, so the account's answer wins.
    setMarketingEmail(u.marketingEmail ?? false);
    setMarketingSms(u.marketingSms ?? false);
    // Header chip appears without leaving the page.
    router.refresh();
  }

  /**
   * What each step must satisfy before the next one opens. These mirror the
   * server's own rules (Zod plus adultAtArrival), so a step can never pass
   * here and be refused at submit.
   */
  function checkStep(index: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (index === 0) {
      if (!form.firstName.trim()) e.firstName = "Please enter your first name.";
      if (!form.lastName.trim()) e.lastName = "Please enter your last name.";
      if (knownUser && !form.email.trim().includes("@")) {
        e.email = "Please enter a valid email address.";
      }
      if (!form.dateOfBirth) {
        e.dateOfBirth = "Please enter your date of birth.";
      } else if (summary && !adultAtArrival(form.dateOfBirth, summary.arrival)) {
        e.dateOfBirth = "The lead booker must be over 18 at the time of arrival.";
      }
      if (!isUsablePhone(form.phoneNumber)) {
        e.phoneNumber = "Please enter a mobile number we can reach you on.";
      }
    }
    if (index === 1) {
      if (showCreateAccount && newPassword.length < 8) {
        e.newPassword = "Please choose a password of at least 8 characters.";
      }
      if (!termsAccepted) {
        e.termsAccepted = "Please accept the booking terms to continue.";
      }
    }
    return e;
  }

  /**
   * Advance past step index, or save an edit to one already behind us. The
   * button is never disabled: a dead button that will not say what is wrong
   * is the worst thing a checkout form can do, so it is always pressable and
   * answers with the missing fields.
   */
  function leaveStep(index: number) {
    const found = checkStep(index);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    if (index < stepsDone) {
      // Editing something finished: hand them back to where they were.
      setOpenStep(Math.min(stepsDone, LAST_STEP));
      return;
    }
    setStepsDone(index + 1);
    setOpenStep(Math.min(index + 1, LAST_STEP));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Belt and braces for the phased path: a guest can reopen a finished
    // step, break it, and reach this button without pressing Save. Refuse,
    // and open the step that is wrong rather than reporting it from afar.
    for (let i = 0; i <= LAST_STEP; i++) {
      const found = checkStep(i);
      if (Object.keys(found).length > 0) {
        setFieldErrors(found);
        if (phased) setOpenStep(i);
        return;
      }
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    const { phoneCountry, phoneNumber, ...fields } = form;
    const result = await apiFetch<{ ok: boolean; accountCreated: boolean }>(
      `/api/session/${sessionId}/details`,
      {
        method: "POST",
        body: JSON.stringify({
          ...fields,
          phone: joinPhone(phoneCountry, phoneNumber),
          title: form.title || undefined,
          marketingEmail,
          marketingSms,
          termsAccepted,
          // Accounts are mandatory: a new email always brings its password.
          password: showCreateAccount ? newPassword : undefined,
          keepSignedIn: showCreateAccount ? keepSignedIn : undefined,
        }),
      },
    );
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      // The email grew an account between the check and the submit: flip
      // into the sign-in card, keeping everything the guest typed.
      if (result.emailTaken) {
        setGate({ email: form.email.trim().toLowerCase(), status: "active" });
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <CheckoutBreadcrumb />
      <h1 className="font-display text-[34px] leading-tight font-bold text-ink mb-5">
        Your details
      </h1>
      <Stepper current="Your Details" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div className="max-w-xl">
          <p className="text-sm text-foreground/70">
            Tell us about the lead booker for your break. We only ask for what
            we need to have everything ready when you arrive.
          </p>

          {knownUser && (
            <p className="mt-6 rounded-md bg-mist border border-line px-4 py-3 text-sm text-olive">
              Booking as <span className="font-semibold">{knownUser.email}</span>. Your
              details are filled in below.
            </p>
          )}

          {showGate && (
            <div className={`mt-6 ${cardClass}`}>
              <p className={cardTitleClass}>Have an account with us?</p>
              {!gate ? (
                <>
                  <p className="mt-1 text-sm text-foreground/60">
                    Enter your email address and we&apos;ll check.
                  </p>
                  <label className="block mt-4">
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
                    <p className="mt-2 flex items-start gap-1.5 text-sm text-[#b3261e]">
                      <AlertIcon />
                      {gateError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={checkEmail}
                    disabled={checking}
                    className="btn-primary mt-4"
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
                      className="text-sm text-navy underline underline-offset-2"
                    >
                      Change
                    </button>
                  </div>

                  {showSignInPanel && (
                    <div className="mt-4 border-t border-line pt-4">
                      <p className="text-sm text-foreground/80">
                        Looks like you already have an account. Sign in and
                        we&apos;ll fill this in for you.
                      </p>
                      <label className="block mt-4">
                        <span className={labelClass}>Password</span>
                        <div className="relative">
                          <input
                            type={showSigninPassword ? "text" : "password"}
                            value={signinPassword}
                            onChange={(e) => setSigninPassword(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                inlineSignIn();
                              }
                            }}
                            className={`${inputClass} pr-11`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowSigninPassword((v) => !v)}
                            aria-label={showSigninPassword ? "Hide password" : "Show password"}
                            className="absolute right-0 top-1.5 bottom-0 flex items-center px-3 text-foreground/50 hover:text-foreground"
                          >
                            {showSigninPassword ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </div>
                      </label>
                      {signinError && (
                        <div className={`mt-3 ${errorClass}`}>
                          <AlertIcon />
                          <span>{signinError}</span>
                        </div>
                      )}
                      <label className="mt-3 flex items-center gap-2 text-sm text-foreground/80">
                        <input
                          type="checkbox"
                          checked={signinRemember}
                          onChange={(e) => setSigninRemember(e.target.checked)}
                          className="h-4 w-4 accent-[#536917]"
                        />
                        Keep me signed in
                      </label>
                      <div className="mt-4 flex items-center gap-4">
                        <button
                          type="button"
                          onClick={inlineSignIn}
                          disabled={signinBusy}
                          className="btn-primary"
                        >
                          {signinBusy ? "Signing in…" : "Sign in"}
                        </button>
                        <Link
                          href="/forgot-password"
                          className="text-sm text-navy underline underline-offset-2"
                        >
                          Forgotten your password?
                        </Link>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* noValidate, with the `required` attributes left on for their
              accessibility semantics: checkStep covers every one of them, and
              letting the browser fire first would mean two different error
              styles on the same form - a native bubble on the last step and
              our own inline messages on the one before it. */}
          <form onSubmit={submit} noValidate className="mt-6 grid gap-5">
            <fieldset
              disabled={!formUnlocked}
              className={`grid gap-5 border-0 p-0 m-0 ${formUnlocked ? "" : "opacity-40"}`}
            >
              <p className="text-xs text-foreground/60">Fields marked * are required.</p>
              <Section
                index={0}
                title="About you"
                subtitle="The lead booker for the break."
                state={stepState(0)}
                summary={aboutSummary}
                onEdit={() => setOpenStep(0)}
              >
                <label className="max-w-[10rem] block">
                  <span className={labelClass}>
                    Title
                    <RequiredMark />
                  </span>
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
                    <span className={labelClass}>
                      First name
                      <RequiredMark />
                    </span>
                    <input
                      required
                      value={form.firstName}
                      onChange={update("firstName")}
                      className={inputClass}
                    />
                    <FieldError message={fieldErrors.firstName} />
                  </label>
                  <label>
                    <span className={labelClass}>
                      Last name
                      <RequiredMark />
                    </span>
                    <input
                      required
                      value={form.lastName}
                      onChange={update("lastName")}
                      className={inputClass}
                    />
                    <FieldError message={fieldErrors.lastName} />
                  </label>
                </div>

                <label className="block">
                  <span className={labelClass}>
                    Date of birth
                    <RequiredMark />
                  </span>
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
                  <FieldError message={fieldErrors.dateOfBirth} />
                </label>

                {knownUser && (
                  <label className="block">
                    <span className={labelClass}>
                      Email <span className="font-normal">(lead guest)</span>
                    </span>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={update("email")}
                      className={inputClass}
                    />
                    <FieldError message={fieldErrors.email} />
                  </label>
                )}

                <div>
                  <span className={labelClass}>
                    Mobile phone
                    <RequiredMark />
                  </span>
                  <div className="flex gap-3">
                    <label className="w-36 shrink-0">
                      <span className="sr-only">Country code</span>
                      <select
                        value={form.phoneCountry}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, phoneCountry: e.target.value }))
                        }
                        className={inputClass}
                      >
                        {PHONE_CODES.map((c) => (
                          <option key={c.label} value={c.label}>
                            {c.label} {c.code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex-1">
                      <span className="sr-only">Phone number</span>
                      <input
                        type="tel"
                        required
                        minLength={7}
                        value={form.phoneNumber}
                        onChange={update("phoneNumber")}
                        className={inputClass}
                        placeholder="717 464 236"
                      />
                    </label>
                  </div>
                  <FieldError message={fieldErrors.phoneNumber} />
                </div>

                {phased && (
                  <div>
                    <button
                      type="button"
                      onClick={() => leaveStep(0)}
                      className="btn-primary"
                    >
                      {stepsDone > 0 ? "Save" : "Continue to the last bit"}
                    </button>
                  </div>
                )}
              </Section>

              <Section
                index={1}
                title={knownUser ? "Almost done" : "Finishing up"}
                state={stepState(1)}
                onEdit={() => setOpenStep(1)}
              >
                {showCreateAccount && (
                  <div className="rounded-lg border border-line bg-white p-5">
                    <p className="font-display text-lg font-bold text-ink">
                      Create your account
                    </p>
                    <p className="mt-2 text-sm text-foreground/70">
                      Every booking comes with a Unity Parks account. With
                      yours you can:
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-sm text-foreground/70 space-y-1">
                      <li>speed up your future bookings</li>
                      <li>see and manage your breaks in one place</li>
                      <li>add and edit your party&apos;s guest details</li>
                      <li>pay your remaining balance any time</li>
                    </ul>
                    <label className="block mt-4">
                        <span className={labelClass}>
                          Choose a password
                          <RequiredMark />
                        </span>
                        <div className="relative">
                          <input
                            type={showNewPassword ? "text" : "password"}
                            required
                            minLength={8}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className={`${inputClass} pr-11`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword((v) => !v)}
                            aria-label={showNewPassword ? "Hide password" : "Show password"}
                            className="absolute right-0 top-1.5 bottom-0 flex items-center px-3 text-foreground/50 hover:text-foreground"
                          >
                            {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </div>
                        <span className="mt-1 block text-xs text-foreground/50">
                          At least 8 characters.
                        </span>
                        <FieldError message={fieldErrors.newPassword} />
                      </label>
                    <label className="mt-4 flex items-center gap-2 text-sm text-foreground/80">
                      <input
                        type="checkbox"
                        checked={keepSignedIn}
                        onChange={(e) => setKeepSignedIn(e.target.checked)}
                        className="h-4 w-4 accent-[#536917]"
                      />
                      Keep me signed in for 6 months
                    </label>
                  </div>
                )}

                <div className="rounded-lg border border-line bg-white p-5 text-sm text-foreground/70">
                  <p className="font-display text-lg font-bold text-ink">
                    Keeping in touch
                  </p>
                  <p className="mt-2">
                    To receive the latest Unity Parks news and information,
                    including our Repeat Guest offer with a KSh 5,000 discount
                    off your next break, as well as your chance to win a break,
                    please tick below.
                  </p>
                  <div className="mt-3 flex gap-6">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={marketingEmail}
                        onChange={(e) => setMarketingEmail(e.target.checked)}
                        className="h-4 w-4 accent-[#536917]"
                      />
                      Email
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={marketingSms}
                        onChange={(e) => setMarketingSms(e.target.checked)}
                        className="h-4 w-4 accent-[#536917]"
                      />
                      SMS
                    </label>
                  </div>
                </div>

                <div>
                  <label className="flex items-start gap-3 text-sm text-foreground/70">
                    <input
                      type="checkbox"
                      required
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[#536917]"
                    />
                    <span>
                      I have read and accept the{" "}
                      <Link href="/terms" target="_blank" className="underline">
                        booking terms and conditions
                      </Link>{" "}
                      and the{" "}
                      <Link href="/terms#safety" target="_blank" className="underline">
                        safety information
                      </Link>{" "}
                      for my break.
                    </span>
                  </label>
                  <FieldError message={fieldErrors.termsAccepted} />
                </div>

                {error && (
                  <div className={errorClass}>
                    <AlertIcon />
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <button type="submit" disabled={busy} className="btn-primary">
                    {busy ? "Saving…" : "Continue"}
                  </button>
                </div>
              </Section>
            </fieldset>
          </form>
        </div>

        {summary && (
          <aside className="mt-8 lg:mt-0 lg:sticky lg:top-6">
            <BookingSummary summary={summary} />
          </aside>
        )}
      </div>
    </div>
  );
}
