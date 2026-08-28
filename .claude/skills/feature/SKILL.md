---
name: feature
description: Drive feature-sized work through the five-phase workflow in docs/ai-development-workflow.md (interview, plan, frozen tests, small slices, layered review). Use when Allan starts a new feature, resumes one, or types /feature. Not for one-sentence fixes.
---

# Feature workflow driver

You are running one feature through the process defined in `docs/ai-development-workflow.md`. Read that doc if you have not this session. This skill tells you where you are and what you may and may not do there.

## Two tiers

At the start, propose a tier and let Allan confirm it:

- **Full path** (this skill's phases): anything touching money, auth, the Prisma schema, Apaleo/Pesapal integration, or any new subsystem. Example: the promotion system.
- **Batch path**: mid-sized work that is bigger than a one-liner but not a new subsystem (client-feedback rounds, sweeps, copy plus small logic changes). Short checklist in the spec or PR description, tests for any new logic, `npm test` evidence per change, one `/code-review` pass. No interview, grilling, or test freeze.

State the chosen tier in your first reply so the choice is logged, not renegotiated later.

## Finding the current phase (full path)

Every feature has one spec file in `docs/`. The state marker is the first line starting with `Status:` within the first 10 lines:

```
Status: interviewing | drafting | grilling | plan-approved | writing-tests | tests-approved | implementing | in-review | shipping | shipped
```

- If the Status value is one of these, resume at that phase, after verifying its evidence (below).
- If a `Status:` line exists but its value is not in this list (older specs use freeform status like "agreed direction" or "BUILT"), ask Allan which state it maps to. Never rewrite it unprompted.
- If no spec exists, create one containing a title and `Status: interviewing`, then start interviewing.

**Evidence check on resume.** Status is written by the agent, so it proves nothing by itself. `plan-approved` and later require a `Plan approved:` evidence line in the spec; `tests-approved` and later also require a `Tests approved:` line whose commit exists in git history as a test-only diff. If the evidence for a Status is missing, treat the spec as being in the previous state and tell Allan why.

Advance the Status line as the last step of each phase, one state at a time.

## Phase rules (full path)

**interviewing.** Ask Allan questions about the problem: goals, edge cases, constraints, what is out of scope. No plan writing yet beyond notes. When you have enough to draft, set Status to drafting.

**drafting.** Write the spec from Allan's answers: problem, out of scope, inputs/outputs/invariants, data model and files touched, edge cases, failure modes, and an end-to-end acceptance check. Flag every decision you made on Allan's behalf in a "Decisions made for you" list. Set Status to grilling.

**grilling.** Two directions, both mandatory:
1. Quiz Allan on the plan until he can explain the design back in his own words. Ask why questions, not yes/no questions.
2. Attack the plan yourself: race conditions, abuse cases, money rounding, Apaleo/Pesapal failure paths, interactions with existing features (referrals, deposits, extras).
Holes become spec edits. Unresolved items go in an "Open questions" section. Then ask Allan for the words "plan approved". Only that phrase (or an unmistakable equivalent typed by Allan) counts. Silence, "looks good", or your own judgment does not. On approval, record in the spec: `Plan approved: <date>, Allan wrote "<verbatim words>"`, and set Status to plan-approved.

**plan-approved.** Waiting state. When Allan says to continue, set Status to writing-tests.

**writing-tests.** Write the full test suite from the spec, colocated `*.test.ts` next to the code under test, in its own commit touching only test files. Test names read like spec lines. Walk Allan through every test and ask for the words "tests approved"; the same strictness applies as at the plan gate, "looks fine" does not count. On approval, record in the spec: `Tests approved: <date>, commit <sha>, Allan wrote "<verbatim words>"`, and set Status to tests-approved.

**tests-approved.** Waiting state. When implementation starts, set Status to implementing.

**implementing.** The hard rules:
- Frozen surface, read-only during this phase: all `*.test.ts`/`*.test.tsx` files, `vitest.config.*`, test setup/mock/fixture files, and the `scripts` block of `package.json`. If any of these is genuinely wrong, stop, explain, get Allan's explicit approval, make the fix its own commit, and append to the spec: `Test change approved: <date>, commit <sha>, reason`.
- Small vertical slices, roughly 100 lines of diff per commit; structural and behavioral changes in separate commits.
- Finish every slice by running the full, unfiltered `npm test` and pasting output that includes the summary counts (test files and tests). Filtered runs are not evidence.
- No unrequested features. Scope changes reopen the spec, not the diff.
When the spec's behavior is implemented and green, set Status to in-review.

**in-review.** In order:
1. Self-review the whole diff against the spec.
2. Frozen-surface audit: diff the branch against main for the frozen surface, `git diff main...HEAD -- '*.test.ts' '*.test.tsx' 'vitest.config.*' package.json` plus any setup/mock paths. Every change there must correspond to an approval line recorded in the spec. Also check for new skips or loosened assertions.
3. Break-one-thing check: deliberately break one piece of logic, confirm a test fails, revert, show both outputs.
4. Run /code-review on the branch yourself. For big features, suggest Allan runs /code-review ultra (only he can launch it). If any review agents error, the review is incomplete; re-run missing dimensions.
5. Anything touching money, auth, or payment credentials: run /security-review.
6. Allan reads the diff to explain-every-line depth. Answer his questions; convoluted explanations are a signal to simplify the code.
7. Open a PR with problem, approach, what was verified, where to look first. **Allan merges the PR himself; never merge it for him.** His merge is the review gate. After he confirms it is merged, set Status to shipping.

**shipping.** Follow the deploy convention: local `prisma db push` first, Allan pushes Railway himself, then git push. Run the spec's end-to-end acceptance check against the deployed environment and show the output. Update the spec with what actually shipped and any decisions that changed. Then set Status to shipped.

## Forbidden regardless of phase

- Writing implementation code before Status is tests-approved with evidence recorded.
- Editing anything in the frozen surface while implementing, without a recorded approval.
- Advancing Status without its gate condition, or advancing more than one state per step.
- Merging the PR.
- Rolling two phases into one turn because the answer seems obvious.

If Allan explicitly tells you to skip a phase, do it, but state in your reply which gate was skipped so the shortcut is visible.
