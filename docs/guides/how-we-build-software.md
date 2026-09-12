# How we build software

## In one paragraph

Unity Parks is built by one person, Allan, working with Claude Code, an AI
coding tool, inside a fixed process. The process exists because AI makes
code cheap to produce and expensive to trust. So every feature starts as a
written plan that Allan approves, then tests that Allan approves, then code
in small pieces that must pass those tests without touching them, then two
rounds of review, then a pull request on GitHub that Allan merges himself.
The Linear board shows where each piece of work is. Git on GitHub is the
record of what actually shipped. Nothing is real until it is merged to the
main branch and deployed.

## Step by step

1. **An issue.** Every feature starts as an issue on the Linear board, with
   a number like UNP-29. Ideas, contractor feedback, and review findings
   that are not fixed on the spot also become issues, filed when they
   surface, so nothing lives only in a chat or an email.
2. **A plan.** Allan and Claude write a short plan document in the docs
   folder. Claude interviews Allan first: goals, edge cases, what must not
   change. Then Claude tries to poke holes in the plan. Nothing is coded
   until Allan writes the words "plan approved".
3. **Tests first, then frozen.** From the plan, Claude writes the tests that
   define what the feature must do, in their own commit. Allan reads them
   line by line and says "tests approved". From then on the tests are
   frozen: the code must be made to pass them, and any change to a test
   needs Allan's separate, explicit approval.
4. **Small slices.** Code is written in small vertical pieces, each one
   small enough to read in one sitting. Each piece ends with the real test
   output shown, not a claim that tests pass.
5. **Review, cheapest first.** Claude reviews its own work against the plan.
   Then a check that the tests were not quietly weakened. Then a fresh
   automated review that did not write the code. Then Allan reads the whole
   change until he can explain every line. If he cannot explain a line, it
   does not merge.
6. **A pull request.** The change goes to GitHub as a pull request with a
   description of the problem, the approach, what was verified, and where
   to look first. The description names the issue, so the board moves on
   its own when the pull request merges.
7. **Merge and deploy.** Allan merges. Railway, the hosting service, deploys
   the main branch automatically. Database changes are applied by Allan by
   hand, locally first and then on the live database.
8. **Record.** The plan document is updated with what actually shipped and
   what changed along the way. The plain-language guide for the feature is
   written or updated. Then the issue is done.

## The rules

- No code before "plan approved" and "tests approved", in those words.
- Tests are frozen during implementation. A test change is a separate
  commit that Allan approves on its own.
- Every slice shows real test output. "Tests pass" as a sentence is not
  evidence.
- Anything touching money, sign-in, the database shape, Apaleo, or Pesapal
  always takes the full path. A one-sentence fix, like a typo, can skip the
  ceremony but still shows what was verified.
- No unrequested features. Scope that grows goes back to the plan, not into
  the change.
- Done means merged to the main branch. A feature branch with commits on it
  is still in progress, whatever the board says.
- The plan documents and the code are the source of truth. Chat history is
  not. If a decision is not written down in the repo, it was not made.
- No em dashes anywhere in code, copy, or documents. A small rule, kept on
  purpose, because it shows whether the process is being followed.

## What can go wrong, and what happens

- Claude misdiagnoses something twice. The rule is to start again with a
  better brief, not to patch a third time on a confused understanding.
- A test is quietly weakened to make code pass. The review step checks the
  test files against their approved version and rejects the change.
- A review runs with parts missing. It is treated as incomplete and rerun.
  A past rerun found two money bugs the first pass missed.
- Something ships that the guide does not describe. The guide is wrong
  until fixed, and fixing it is part of the feature, not a later task.
- A contractor sends notes by email. They are turned into an issue or a
  pull request against the docs folder, so the record stays in one place.

## What a person does

- **Allan:** approves plans and tests in writing, reads every change before
  merging, merges, deploys database changes, and answers the open decisions
  in the lean operations register.
- **The contractor:** reads the guides and the register on GitHub, raises
  questions and corrections as issues or pull requests, and uses the
  decisions table in the register as the meeting agenda.
- **Claude:** interviews, drafts plans and tests, writes the code in slices,
  shows evidence, reviews, files issues for anything it finds, and keeps
  the guides honest.

## For developers

- `docs/ai-development-workflow.md`: the full five-phase process with the
  research behind each rule.
- `CLAUDE.md`: the standing instructions Claude reads at the start of every
  session, including the Linear conventions and the no change detector
  tests rule.
- `.claude/skills/feature/SKILL.md`: the skill that drives a feature
  through the five phases.
- `docs/lean-operations.md`: the register of operational concerns and
  decisions.
