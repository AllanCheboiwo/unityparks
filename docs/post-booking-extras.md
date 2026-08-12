# Extras after booking: engine reference

Status: BUILT, 7 Aug 2026 (branch `outstanding-features`, commit 6825c00).
Written after the build, like the referral doc, so it describes the system
that exists rather than one that was planned. The third money engine
alongside `deposit-and-cancellation-plan.md` and `referral-system-plan.md`,
and the smallest of the three.

The feature: a guest with a booked break adds extras (Apaleo services) to a
lodge from Manage my booking, up to the day before arrival. The checkout
extras page has promised this in copy since it was built.

## The verified fact everything rests on

`PUT /booking/v1/reservation-actions/{id}/book-service` **sets a service
count absolutely**. Proven live against the UPNV sandbox on 7 Aug: a
reservation holding 2 bikes, sent `count: 3`, ends up with 3 bikes and a
folio repriced to match, not 5. Three consequences shape the whole engine:

- "Add N more" means read the current count and book `current + N`. The
  route never sends a delta.
- A retry of the same target converges instead of double-adding.
- Writing the previous count back is an **exact** rollback, and for a
  service that was not there at all, `DELETE .../services` answers 204 even
  when already gone. Every undo path is therefore idempotent.

The reservation-scoped `GET /booking/v1/reservations/{id}/service-offers`
exists but was not used: it omits services already on the reservation, and
the engine needs the price of a service the guest already holds in order to
sell them a second one. Pricing therefore comes from the same
`GET /booking/v1/service-offers` the checkout page uses, with owned counts
read separately from `GET /booking/v1/reservations/{id}/services`.

## The policy

- Extras can be added while a booking is `paid` or `deposit_paid`, never
  once cancelled, and never on or after the arrival date (from then on the
  village team sells in person).
- Prices are always Apaleo's, derived server-side from live offers. The
  client sends service ids and counts only; a doctored request cannot
  smuggle an amount.
- The LOCATION fee is filtered out, exactly as on the checkout extras page:
  it is sold by the location step, never as an extra.
- Per-person services cap at 8 per lodge across what is owned plus what is
  being added (`MAX_EXTRA_QTY`, the same cap the checkout stepper uses).
  Room-priced one-offs cannot be bought twice.

## The two money paths

Which path applies is decided by the booking's payment state, not by the
guest.

**`charge_now` (status `paid`).** The new charge settles on the folio
immediately, the same simulated-money move the amend route makes for a
price difference: `payFolio` for the folio's whole balance under a
per-order idempotency key. `totalGrossAmount` and `paidAmount` both grow by
the observed delta, so the booking stays fully paid and the folio returns
to zero.

**`on_balance` (status `deposit_paid`).** Nothing is collected. The charge
joins the outstanding balance and the existing `/pay` route collects it
later. `totalGrossAmount` and the lodge's `grossAmount` grow by the delta
while `paidAmount` does not.

In both paths the frozen snapshots move by exactly the delta the folio
actually showed. That is what keeps `settlePayment`'s folio-drift check
green: the next balance payment reads a folio and local bookkeeping that
still agree. The E2E deliberately walks deposit-add-then-pay-in-full for
this reason.

## The order row, serialization and recovery

Every operation creates an `ExtrasOrder` **before the first Apaleo write**,
carrying the priced additions with `previousCount`, `addCount` and
`targetCount` per service, the expected delta, and the kind. Its unique
`liveForRecordId` column is the serializer, borrowed wholesale from
`PesapalTransaction`: two concurrent adds on one booking become a
constraint violation, not two bookings.

Mutual exclusion with the other engines is advisory and mutual: the extras
engine refuses while a live `PesapalTransaction` exists, and both `/pay` and
`/amend` run `recoverStaleExtrasOrder` before they touch a folio. Neither
engine can see the other's mid-flight folio moves, `settlePayment` derives
paid amounts from folio balances, and the amend route's step-3 sweep pays
off whatever a folio owes, so they take turns. The residual millisecond
window surfaces as the settle engine's loud drift wedge, never as silent
money.

Those two callers deliberately go through recovery rather than a bare
existence check. A bare check would refuse forever if an order ever crashed:
recovery is otherwise reachable only from the extras card, which stops
rendering once arrival passes, so a wedged balance could never be paid.

Before any quote or add, `recoverStaleExtrasOrder` resolves a live order
older than the five-minute grace (generous because the Apaleo client
retries 429s honouring Retry-After, so a slow original must be allowed to
finish before a refresh rolls its work back under it). `resolveOrder`
decides from the folio's and reservation's truth, never from an assumption
about where a crash happened:

| Reading | Ending |
|---|---|
| Record no longer payable (racing cancellation) | roll back, retire, log loudly |
| `charge_now`, folio settled, counts at target | the payment landed; finish the bookkeeping |
| `charge_now`, folio settled, counts at previous | nothing net happened; retire |
| anything else | set counts back to previous, verify the folio returned to its baseline, retire |

Recovery runs **before** the status gates on purpose: a crashed order on a
booking that has since cancelled must still be resolvable, and the gates
would refuse first.

`verifyFolioRestored` logs loudly when a rollback leaves the folio off its
starting balance. Nothing in code can fix that case, but it must never be
silent.

## The bookkeeping transaction

One `prisma.$transaction` retires the order, grows the record and child
snapshots, and merges the additions into the session's extras JSON (plus
the legacy slot-0 mirror) so confirmation and summary pages keep telling
the truth. Both flips are guarded: the order must still be `created`, and
the record must still be in the status the money move assumed. A racing
cancellation therefore fails loudly rather than settling money onto a
cancelled break.

## Accepted edges

Documented rather than built, in the spirit of the other two engines.

- **Rollback at changed rates.** If a service's rate changes mid-request,
  the rollback restores counts exactly but the surviving services reprice
  at the new rate, so the folio can land off its baseline. Detected and
  logged by `verifyFolioRestored`; no automatic repair.
- **Deposits do not grow.** A post-booking add grows the total but not
  `depositAmount`, so the non-refundable portion of a cancellation stays
  what it was at booking. Guest-favouring, and deliberate.
- **No removal.** Guests cannot take extras off a booking themselves. The
  Apaleo removal wrapper exists and the rollback path uses it, but
  self-serve removal needs a refund policy decision first.

## Files

| Concern | File |
|---|---|
| Apaleo wrapper | `server/apaleo/services.ts` (`getReservationServices`, `bookReservationService`) |
| Engine | `server/booking/extras.ts` (`quoteManageExtras`, `addManageExtras`, `recoverStaleExtrasOrder`) |
| Pure math | `lib/extras.ts` (`priceAdditions`, `mergeExtras`, `extraUnitPrice`), tested in `lib/extras.test.ts` |
| Route | `app/api/booking/[bookingId]/extras/route.ts` (GET quote, POST add) |
| Receipt email | `server/email/extrasReceipt.ts` |
| UI | `app/manage/[bookingId]/AddExtrasCard.tsx` |
| Schema | `ExtrasOrder` in `prisma/schema.prisma` |

## The legacy paidAmount sentinel

Worth knowing before touching the settle. Records from before the deposit
feature store `paidAmount = 0` while being fully paid, and the schema says
so: every consumer normalises it (cancellation's `effectivePaid`,
`settlePayment`'s split basis via the child's `paidAt`, the booking GET).
The first version of this engine grew `paidAmount` with a blind increment,
which turned a legacy record's 0 into just the extra's value: the sentinel
was gone, `effectivePaid` stopped falling back, and a guest who had paid
KES 100,000 and added one KES 3,000 bike would have been refunded nothing
instead of KES 70,000 on cancellation. The settle now lifts the sentinel to
the truth before adding the delta, on both the record and the child, and
`lib/paymentPlan.test.ts` pins the arithmetic in both directions.

## Verification

Live E2E against the UPNV sandbox and a dev server on the simulated
payments provider, 7 Aug: 27 checks covering both money paths, the folio
staying settled on the paid path, the outstanding balance growing then
settling cleanly on the deposit path (the drift-wedge test), owned-count
requoting, the one-off re-add refusal, the quantity cap, the LOCATION
refusal, and the proof-of-access refusals. Plus unit tests on the pure math
and the refund arithmetic, and two adversarial review rounds (eight
dimensions in total, every finding independently verified before it was
acted on) whose confirmed findings are all fixed.
