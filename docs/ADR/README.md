# Architecture decision records

Dated records of decisions that were hard to make and would be expensive to
reverse — why a thing is the way it is, not how to use it.

| # | Decision | Status | Date |
|---|----------|--------|------|
| [0001](0001-tiered-rag-levels.md) | Tiered RAG levels for AI insights | Accepted | 2026-07-22 |
| [0002](0002-insights-and-monthly-snapshots.md) | Spending-pattern insights and monthly snapshots | Accepted | 2026-07-26 |
| [0003](0003-analytics-consent-and-taxonomy.md) | Opt-in analytics: consent gate and event taxonomy | Accepted; consent model superseded by 0004 | 2026-07-27 |
| [0004](0004-tier-gated-analytics.md) | Usage statistics are part of the free tier | Accepted | 2026-07-27 |
| [0005](0005-prompt-registry-and-provider-parity.md) | One prompt registry, and a contract the providers must satisfy | Accepted | 2026-07-27 |

## What belongs here

A decision with a real alternative and a real cost. If there was only one
sensible option, there is nothing to record.

Reference material — what a feature does, how to configure it, what the
parameters mean — belongs in a document beside this folder (`../insights.md`,
`../analytics.md`) and is written for someone using the feature. An ADR is
written for someone who is about to change it and needs to know what the last
person already considered.

The two often come in pairs: the doc says what the system does, the ADR says
why it does that and what was rejected.

## Format

One file per decision, `NNNN-kebab-case-title.md`, numbered in the order they
were accepted. Numbers are never reused and files are never deleted — a
decision that no longer holds gets its status changed and a pointer to the
record that replaced it, because the fact that it was once decided the other
way is itself the useful part.

Open with a heading, then a status line:

```markdown
# 7. Short statement of the decision

**Status:** Accepted, implemented · **Date:** 2026-07-27 · **Issues:** #123
```

Status is one of **Proposed**, **Accepted**, `Superseded by NNNN` (linked), or
**Deprecated**. Add `, implemented` to an accepted decision once the code
matches it — the gap between deciding and shipping is worth being able to see.

Then **Context** (the forces, the problem, what made this hard) and
**Decision** (what was chosen, and what was rejected and why). After that,
whatever the decision actually produced: *Consequences*, *Departures from the
issues*, *Things that only became apparent while building*, *Known gaps*. Those
last three are usually the most valuable part and should not be flattened into
a generic consequences list to satisfy a template.

Write what was true at the time. An ADR is not maintained as the code changes;
if the decision is revisited, that is a new record.
