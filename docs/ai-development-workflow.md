# AI-Driven Development Workflow

How we build features in this project with Claude. The goals, in order:

1. Allan thoroughly understands everything that ships.
2. The code is correct, boring, and maintainable.
3. The process is repeatable, the same steps every feature, so quality does not depend on mood or memory.

This is based on what experienced practitioners at Anthropic, Google, GitHub, and Thoughtworks recommend, plus Kent Beck's and Simon Willison's writing on coding with AI. Sources are linked at the bottom. It starts from Allan's proposal (plan, grill the plan, TDD, implement, review tests for cheating, formal review) and adjusts it where the research disagrees.

## The workflow at a glance

```
1. PLAN        Write a spec together. Claude grills Allan on it. Both poke holes.
               Allan signs off before any code exists.
2. TESTS       Write the tests from the spec, in their own commit.
               Allan reviews the tests line by line. Tests are then frozen.
3. IMPLEMENT   Small vertical slices. Tests are read-only. Evidence, not claims.
4. REVIEW      Self-review, test-cheating audit, /code-review, then Allan
               reads the diff until he can explain every line.
5. SHIP        PR with a real description. Merge, deploy, record decisions.
```

Skip the ceremony only when the whole change fits in one sentence and one small diff (a copy fix, a config tweak). Everything feature-sized goes through all five phases.

## Phase 1: Plan

**Order of operations: interview, then draft, then grill.** Claude asks Allan questions first (goals, edge cases, constraints, out of scope), then writes the plan from the answers, then we grill the written plan. The interview comes first so the plan is built from Allan's thinking rather than read passively; the grilling comes last because only a concrete written plan can be meaningfully attacked.

**What happens.** We write a short spec in `docs/` before any code. For the promotion system that file already exists as a starting point: `docs/promo-codes-plan.md`. The spec covers:

- The problem in plain language, and what is explicitly out of scope.
- Inputs, outputs, and invariants ("a promo code never reduces a folio below zero", "one redemption per booking").
- The data model and which files change.
- Edge cases and failure modes.
- How we will verify it end to end when done (the acceptance check).

**The grilling.** This is the step Allan asked for and the research supports it strongly. Anthropic's own guidance is to have the model interview you and write the spec from your answers. Concretely:

- Claude asks Allan questions until Allan can explain the design back in his own words: why this data model, what happens in each edge case, what breaks if an assumption is wrong.
- Then both sides attack the plan. Claude plays adversary: race conditions, abuse cases (promo code stacking, referral plus promo), money rounding, what Apaleo or Pesapal does in the failure path.
- Anything Allan cannot answer yet becomes either a spec change or an open question written into the doc. No hand-waving survives into Phase 2.

**Gate.** Allan says "plan approved" explicitly. Thoughtworks calls human sign-off on the AI-era design "mandatory before any code generation", and Anthropic's guidance is the same. Claude does not start writing tests or code before this.

## Phase 2: Tests first, then frozen

This is where the research refines Allan's original idea. Two findings matter:

- Kent Beck: TDD is a "superpower" with agents because agents introduce regressions, and the classic failure is the agent deleting or weakening a failing test instead of fixing the code.
- Birgitta Böckeler (Thoughtworks) ran the experiment: forcing the agent to perform strict red-green-refactor inside its loop was mostly theater, cost 3 to 8 times the tokens, and sometimes produced worse designs. What actually helps is tests as an immutable external oracle.

So we do not cargo-cult the red-green ritual. We do this instead:

1. Claude writes the test suite directly from the approved spec, before the implementation, in its own commit. Test names read like the spec ("rejects an expired code", "applies percentage discount to accommodation only, not fees").
2. **Allan reviews the tests, not skims them.** This is the highest-leverage review in the whole workflow, because whoever controls the tests controls what "done" means. For each test ask: does this assert real behavior, or does it just mirror the implementation? Would it fail if the code were broken? (That question is straight from Google's review guide.) Are the amounts and edge cases from the spec actually present?
3. Once approved, **tests are frozen**. During implementation Claude does not edit, delete, skip, or loosen any test. If a test turns out to be wrong, Claude stops, says so, and Allan approves the test change as a separate visible commit. Any silent test edit in an implementation diff is treated as an incident, not a nitpick.

### No change detector tests

A change detector asserts *how* the code works rather than *what* it guarantees. It goes red on a refactor that broke nothing, so it costs more than it protects.

The check, applied to every test before it is approved: **if the function were rewritten completely but behaved identically, would this test still pass?** If no, it is a change detector and it gets rewritten or dropped.

In practice that means:

- Assert observable outcomes and invariants, not internal structure. "Invoice total equals charges minus allowances", not "calls the helper twice".
- Do not assert call counts or call order unless the ordering IS the guarantee (oldest-first draining, one Zoho push per row).
- Test through the public entry point. A test for an internal helper needs a reason: the rule is genuinely unreachable from outside, or reaching it costs an unreadable amount of setup.
- No blanket snapshots of whole objects for their own sake. Pinning an exact shape is allowed only when the shape itself is the guarantee, and the test must say so in a comment (the no-PII key list in `lib/zohoMap.test.ts` is the worked example).
- Fakes are dumb storage. Every decision belongs to the module under test, so the test fails when that logic breaks and not otherwise.

When Claude writes a test that trips this rule anyway, it flags it inline with the reason it is worth the trade, so Allan can rule on it during the Phase 2 review rather than discovering it during a refactor.

For behavior that is hard to unit test (Apaleo calls, Pesapal webhooks), the spec's acceptance check from Phase 1 is the substitute: a scripted end-to-end walkthrough we run before calling it done.

## Phase 3: Implement

- **Small vertical slices, not one big drop.** Google's data says small changes get reviewed more thoroughly with fewer missed bugs, and their reference point is roughly 100 lines per change. AI makes big diffs cheap to produce but not cheap to review, so diff size is the main lever we control. One slice = one reviewable commit.
- **Structural and behavioral changes in separate commits** (Kent Beck). A refactor commit should show tests untouched and green. A behavior commit should be small enough to read.
- **Evidence, not assertions.** Claude finishes a slice by showing the actual test run output, not by saying "tests pass". Anthropic's rule: if you can't verify it, don't ship it.
- **Restart instead of thrash.** If Claude has misdiagnosed something twice, the fix is a fresh start with a better prompt, not a third patch on a confused context (Anthropic, Böckeler). Suspiciously easy solutions get double-checked.
- **No unrequested features.** Beck lists unrequested functionality as one of the three signs an agent is derailing (with unnecessary loops and test manipulation). Scope creep goes back to Phase 1, not into the diff.

## Phase 4: Review

Layered, cheapest first, so Allan's attention lands where machines cannot help.

1. **Claude self-reviews** the full diff against the spec before presenting it: leftovers, debug code, drift from the plan. GitHub recommends exactly this pass before human review.
2. **Test-cheating audit.** Explicit checks, because research on agent reward hacking shows outcome-only scoring invites gaming:
   - `git diff` on the test files since their approved commit must be empty.
   - No new skips, no broadened tolerances, no hard-coded expected values that mirror the implementation.
   - Spot-check: break one piece of logic on purpose and confirm a test fails, then revert. This is the cheap version of mutation testing and directly answers Google's "will the tests fail when the code is broken?"
3. **Fresh-context review.** Run `/code-review` on the branch. A reviewer that did not write the code has no bias toward it (Anthropic runs reviews in fresh context for this reason). Per the standing rule in memory: a review with errored agents is incomplete, re-run missing dimensions.
4. **Allan reads the diff.** The bar comes from Google plus the "you own what you ship" principle: if you can't explain a line, don't merge it. Reading order: data model and money math first, then control flow, then the rest. Where something is unclear, Allan asks Claude to explain it, and if the explanation is convoluted, that is usually a sign the code should be simpler, not that the explanation should be longer.
5. **PR on GitHub** with a description that states problem, approach, what was verified, and where a reviewer should look first. Even solo, the PR is the durable record and the place `/code-review ultra` can run for big features.

Google's merge standard applies: merge when the change definitely improves overall health, even if imperfect. Perfection-polishing loops are how AI review turns into over-engineering.

## Phase 5: Ship and record

- Follow the existing deploy convention: local `prisma db push` first, Allan pushes Railway himself, then git push.
- Run the end-to-end acceptance check from the spec on the deployed environment.
- Update the spec doc with what actually shipped and any decisions that changed along the way, so the doc stays the source of truth instead of the chat history.

## Standing rules that make this work

- **Allan owns every line that ships, regardless of who typed it.** AI origin is not an excuse and not a disclaimer.
- **Diff size is the quality lever.** When a slice grows past comfortable reading size, split it.
- **Tests are read-only during implementation.** Test changes are always their own visible, approved commit.
- **Human sign-off gates every phase transition.** Plan approved, tests approved, review done. Claude does not roll phases together.
- **Encode standards in tools, not prose, where possible.** Lint rules, CI checks, and this repo's existing scripts beat instructions in a markdown file. Keep CLAUDE.md short and pruned; bloated instruction files get ignored (Anthropic, Thoughtworks both report this).
- **Security is reviewed explicitly, not incidentally.** AI reproduces insecure patterns from training data and does not know our threat model. Money math, auth checks, and anything touching Pesapal or Apaleo credentials get a dedicated look, and `/security-review` before merging anything payment-adjacent.

## How this is enforced

The process does not depend on Allan remembering it. Three layers:

1. **The `/feature` skill** (`.claude/skills/feature/SKILL.md`). Typing `/feature promo codes` loads the phase driver into Claude's context. Each feature's spec doc carries a `Status:` line (interviewing, drafting, grilling, plan-approved, writing-tests, tests-approved, implementing, in-review, shipping, shipped) so the process survives across sessions: a new session reads the status, verifies the recorded approval evidence, and resumes at the right phase. Gates require Allan's explicit words ("plan approved", "tests approved"), which get quoted into the spec with a date so a later session can tell a real approval from a self-written status. Allan merges PRs himself; that merge is the final review gate.
2. **`CLAUDE.md`** at the repo root. Loaded every session, it tells Claude to route any feature-sized request into the skill even when Allan just says "add X". Casual requests can't bypass the process.
3. **Deterministic checks.** `npm test` (vitest) as the evidence command, the recorded tests-approved commit sha for the frozen-test `git diff` audit, and the break-one-thing check. These are commands, not promises.

The harness adds its own layer on top: plan mode for exploration, `/code-review` and `/security-review` for fresh-context review, and ultracode's multi-agent adversarial verification for the heaviest features.

## Where the research adjusted the original proposal

Allan's instincts were validated on almost every point: plan first, grill the plan, tests before code, review tests for cheating, formal review at the end. Three refinements from the research:

1. **Tests-as-guardrails beats TDD-as-ritual.** Write and approve the whole suite from the spec, then freeze it. Do not make the agent perform red-green-refactor one test at a time; the evidence says that burns tokens without improving quality.
2. **"Cursory view of the code" is not enough.** The review layers above exist so the machine work is done before Allan reads, but the final read must reach explain-every-line depth. That is the step that produces the understanding this whole system is for.
3. **Add the missing lever: small slices.** The original proposal had good phases but nothing about size. Every source that measures outcomes points at diff size as the strongest predictor of review quality.

## Sources

Plan-first and agentic workflow:

- Anthropic, [Claude Code best practices for agentic coding](https://code.claude.com/docs/en/best-practices). Explore, plan, implement, commit; fresh-context review; evidence over assertions; spec-writing interviews.
- Thoughtworks, [Spec-driven development](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices). Spec as primary artifact, mandatory human review of the design before code.
- Simon Willison, [Here's how I use LLMs to help me write code](https://simonwillison.net/2025/Mar/11/using-llms-for-code/) and [Embracing the parallel coding agent lifestyle](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/). The over-confident pair programmer model; you must test what it writes; review throughput is the bottleneck.

TDD and test integrity:

- Kent Beck, [Augmented Coding: Beyond the Vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) and the [Pragmatic Engineer interview](https://newsletter.pragmaticengineer.com/p/tdd-ai-agents-and-coding-with-kent). Tests as guardrails, agents deleting failing tests, structural vs behavioral commits.
- Birgitta Böckeler, [TDD inside the agent loop: theater or actual value?](https://martinfowler.com/articles/exploring-gen-ai/tdd-in-the-agent-loop.html). The ritual does not transfer to agents; immutable expectations and human checkpoints do.
- [Do Coding Agents Deceive Us?](https://arxiv.org/abs/2506.07379) (arXiv) and Appen, [Reward hacking in AI agent evaluation](https://www.appen.com/blog/reward-hacking-ai-agent-evaluation). How agents game tests and how to detect it.

Code review discipline:

- Google eng-practices, [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html), [The standard of code review](https://google.github.io/eng-practices/review/reviewer/standard.html).
- GitHub, [Helping others review your changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/helping-others-review-your-changes) and [Copilot for code reviews and pull requests](https://github.blog/ai-and-ml/github-copilot/how-to-use-github-copilot-to-level-up-your-code-reviews-and-pull-requests/).
- Senko Rašić, [Your code is your responsibility, even if AI wrote it](https://blog.senko.net/your-code-is-your-responsibility-even-if-ai-wrote-it).
- Birgitta Böckeler, [The role of developer skills in agentic coding](https://martinfowler.com/articles/exploring-gen-ai/13-role-of-developer-skills.html) and [Maintainability sensors for coding agents](https://martinfowler.com/articles/sensors-for-coding-agents.html).
