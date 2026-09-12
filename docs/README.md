# Unity Parks documentation

Two tiers, one home. Everything lives in this folder and is read on
GitHub. Nothing is emailed.

## Guides (start here if you are not a developer)

Plain language, no code, written only from what the code does today. Each
one ends with "what a person does". Together they are the operations
handbook.

- [How booking works](guides/how-booking-works.md)
- [How payments work](guides/how-payments-work.md)
- [How cancellation and refunds work](guides/how-cancellation-and-refunds-work.md)
- [How referrals work](guides/how-referrals-work.md)
- [How the repeat-guest offer works](guides/how-the-repeat-guest-offer-works.md): also explains that there are no typed promo codes today
- [How the systems fit together](guides/how-the-systems-fit-together.md)
- [How we build software](guides/how-we-build-software.md): the process
  every feature follows, from a Linear issue to a merged pull request

Rule: a feature is not done until its guide exists, and a guide may only say
what the code actually does. Found something wrong or missing? Open a pull
request against the guide, or comment on the Linear issue.

## The register

- [Lean operations](lean-operations.md): every process that could need a
  person, what the system does today, the proposal, and the open decisions.
  This is the agenda for contractor meetings.
- [Failure catalogue](failure-catalogue.md): every way the money path can
  fail, what state it leaves, who finds out, and what a person does. Rows
  without an answer are Linear issues.

## Engineering (for developers)

- [AI development workflow](ai-development-workflow.md): the five-phase
  process every feature follows. Read this before writing code.
- [Design system](DESIGN.md): voice, visual system, and the policy copy.
- [Features report](FEATURES-REPORT.md): what is built and what is not.
- [Content strategy](content-strategy.md) and
  [village and content direction](village-and-content-direction.md):
  the Mount Kenya setting and what the site says.
- [Learning list](learning-list.md).

Feature plans, one per feature, each with a status line at the top. Code
comments cite them by path, so they stay here:

- [Deposit and cancellation](deposit-and-cancellation-plan.md)
- [Referral system](referral-system-plan.md)
- [Promo codes and repeat offers](promo-codes-plan.md)
- [Invite a guest](invite-a-guest-plan.md)
- [Mandatory accounts](mandatory-accounts-plan.md)
- [Post-booking extras](post-booking-extras.md)
- [Activity inventory](activity-inventory-plan.md)
- [Zoho accounting export](zoho-accounting-plan.md)
- [Payload CMS](payload-cms-plan.md)
- [Mount Kenya sweep](mount-kenya-sweep.md)

## Archive

Early Word documents and the Center Parcs research that shaped the demo.
Kept for history, not maintained: [archive/](archive/).
