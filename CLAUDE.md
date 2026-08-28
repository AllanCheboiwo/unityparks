# Unity Parks frontend

Center Parcs-style booking demo. Next.js + Prisma + Postgres, Apaleo sandbox PMS, Pesapal sandbox payments. Solo builder (Allan). Code style: boring, explainable, maintainable. No em dashes anywhere (code, copy, comments).

## Development process (non-negotiable)

Feature-sized work follows `docs/ai-development-workflow.md`, driven by the `/feature` skill. If Allan asks for a feature without invoking it, invoke the feature skill yourself before writing any code. Key gates:

- No implementation code before Allan has said "plan approved" and "tests approved".
- Tests are frozen during implementation; test edits need Allan's explicit approval as separate commits.
- Every slice ends with real `npm test` output shown, not claimed.

Sizing: full path for anything touching money, auth, the Prisma schema, Apaleo/Pesapal, or a new subsystem. The skill's batch path for mid-sized work (feedback rounds, sweeps). One-sentence fixes skip the ceremony but still show test/verification evidence.

## Linear (project tracking)

The kanban board in Linear (official MCP + GitHub integration) is the visible read-out of work for Allan and his contractor. It never gates anything; git stays the source of truth.

- Feature-sized work starts from a Linear issue. If Allan asks for a feature with no issue, create one first, then proceed as normal.
- Branch names include the issue ID (e.g. `unp-7-promo-codes`); PR descriptions include "Fixes UNP-7" so the GitHub integration moves issues automatically. Team prefix is UNP.
- Done means merged to main. Commits on a feature branch keep the issue In Progress; note pending Railway deploy steps as an issue comment, not a status.
- Review findings or out-of-scope discoveries that are not fixed inline become Backlog issues, filed at the moment they surface.
- Say what you did in chat whenever you write to Linear (e.g. "filed UNI-23"), so the board never changes silently.

## Conventions

- Database: `prisma db push` only, never `prisma migrate`. Local first (brew postgresql@15, unity_parks_dev); Allan pushes Railway himself, then git push.
- Tests: vitest, colocated `*.test.ts`, run with `npm test`.
- No change detector tests. Assert what the code guarantees, not how it works. The check: if the function were rewritten completely but behaved identically, would this test still pass? If no, rewrite it. Details in `docs/ai-development-workflow.md`.
- Money: amounts flow through the folio; check `lib/paymentPlan.ts` patterns before adding money math.
