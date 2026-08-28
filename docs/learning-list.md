# Learning list

Things that came up in the code that I want to understand properly on my own time.
Living list. Add to it whenever something in the codebase reads as magic.

How to use it: when a line stops you, add a bullet with where you saw it. Tick it
off once you can explain it to someone else without looking. Delete nothing, the
ticked items are the record of what I have learned.

## TypeScript

- [ ] Utility types: `Partial<T>`, `Pick`, `Omit`, `Required`, `Record`. Seen as `Partial<FolioSnapshot>` in `lib/zohoMap.test.ts:17`.
- [ ] Structural typing, and `interface` vs `type`. Seen as `class FakeStore implements ExportStore` in `server/zoho/export.test.ts:29`.
- [ ] Discriminated unions.
- [ ] `as const` and literal types. Seen as `return "duplicate" as const` in `server/zoho/export.test.ts`.

## JavaScript

- [ ] Object and array spread, and why position decides who wins. Seen as `...overrides` in `lib/zohoMap.test.ts:26`.
- [ ] Destructuring with defaults.
- [ ] Numeric separators, `45_000` is the same number as `45000`.
- [ ] The options object pattern, passing one named-fields object instead of positional arguments. Seen as `buildInvoicePayload({ customerId, bookingReference, folios })`.

## Testing

- [ ] Fixture builders, also called the object-mother pattern. The `folio()` helper in `lib/zohoMap.test.ts:17`.
- [ ] Fakes vs mocks vs stubs, and which one `FakeStore` is.
- [ ] Dependency injection for testability. Why `fetchImpl` is a parameter in `server/zoho/client.test.ts` rather than a global `fetch` call.
- [ ] Test names written as full-sentence specifications.
- [ ] Test-first, and what "frozen tests" means in `docs/ai-development-workflow.md`.
- [ ] Vitest basics: `describe`, `it`, `expect`, and `toEqual` vs `toBe`.
- [ ] Change detector tests, and why they are the main failure mode of test-first work. The rule now lives in `CLAUDE.md` and Phase 2 of `docs/ai-development-workflow.md`.

## Patterns in the Zoho export (UNP-5)

- [ ] Outbox pattern, and what problem it solves.
- [ ] Idempotency keys. Seen in `server/referral/checkout.ts:389`.
- [ ] OAuth refresh token flow.
- [ ] Optimistic claim, how two overlapping drains avoid pushing the same row twice.
- [ ] Retry with a max attempt count and a stale timeout. `MAX_ATTEMPTS` and `STALE_PUSHING_MS` in `server/zoho/export.ts`.

## Concepts already answered in chat

Short answers I have had, kept here so I do not ask twice.

- **`slot`** is the index of a lodge inside one booking, 0-based. Two lodges gives slots 0 and 1. It is not the unit number, the physical unit is assigned separately and can be null. Repo-wide convention, see `lib/types.ts:53`.
- **`...overrides`** copies the caller's keys over the defaults, top level only, whole value at a time. An empty object changes nothing, which is why `folio()` with no argument works.
