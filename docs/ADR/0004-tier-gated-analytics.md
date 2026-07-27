# 4. Usage statistics are part of the free tier

**Status:** Accepted, implemented · **Date:** 2026-07-27 · **Supersedes the consent decision in [0003](0003-analytics-consent-and-taxonomy.md)**

## Context

[0003](0003-analytics-consent-and-taxonomy.md) made analytics opt-in for
everyone, defaulting to off. That shipped, and the property stayed empty —
which is the predictable outcome of a default-off setting whose only discovery
surface is a panel inside Settings. The first-run ask that would have made
opt-in viable is blocked on the onboarding flow in #83.

The product position is that usage statistics are part of what the free tier
gives back: the app is free, and knowing which parts of it get used is what
funds deciding where to spend effort. Paying removes that.

## Decision

Collection is determined by tier, not by an unconditional preference:

| Tier | Collection | `enableUsageAnalytics` |
|---|---|---|
| Free (no subscription record) | Always on | Not read |
| Premium | The stored preference, absent meaning off | Read |
| No account | Never | Not read |

`usageAnalyticsEnabled()` now takes the whole `User` rather than the
preferences map, because tier and preference both live on it and a function
that sees only preferences cannot answer the question. `canDisableUsageAnalytics()`
is the matching entitlement check that drives the UI.

**The free tier ignores a stored `false`.** A preference left behind by an
account that was once premium must not disable collection the free tier
includes. Not reading the field at all is what makes that true, rather than
reading it and overriding.

**Signed out is still never.** No account means nothing to attribute to a tier,
so the pre-auth window stays silent by construction — the one property from
0003 that survives unchanged, and the one that keeps the login screen clean.

**The setting stays visible on the free tier, disabled.** Hiding it would be
worse: the collection is happening either way, and a setting that shows the
real state with the reason next to it is a disclosure. Hiding it makes the same
collection undisclosed. The handler re-checks the entitlement because a
disabled control is a UI affordance, not a guarantee.

**All user-facing copy changed in the same commit as the behaviour.** The
Settings description, the disclaimer, the about-page privacy card and the
README feature bullet all previously said "off unless you turn it on". Leaving
any of them would have been a false privacy claim, which is worse than the
collection itself.

## Consequences

Every account is currently in the always-on bucket, because premium is
unimplemented — the structure exists (`SubscriptionTier`, `subscription?` on
the user) but there is no payment integration and
`receipt-quota.service.ts` describes premium as a future release. So in
practice this ships analytics that no user can switch off.

That was understood and accepted when the decision was made. It is recorded
here because the reasoning only holds once premium exists, and someone reading
this later should not have to reconstruct that.

### The unresolved part: GDPR

Analytics storage needs freely-given consent under GDPR and ePrivacy.
Conditioning it on the free plan is the "consent or pay" model, which the EDPB
accepts only where the paid alternative genuinely exists and is reasonably
priced. Today it does not exist, so an EU or UK user has no alternative to be
pointed at, and "freely given" is not satisfiable.

Two things close this, and one of them has to happen before the app is offered
to EU or UK users in earnest:

1. **Ship premium**, making the paid alternative real.
2. **Keep the free tier opt-in for those regions**, which needs region
   detection and turns this into a two-mode policy.

Neither is in this change. Mitigating factors, which reduce but do not remove
the exposure: Google signals and ads personalisation are off, there is no
`setUserId`, no advertising or remarketing, and the payload is an enumerated
allowlist that cannot carry personal data. What is collected is genuinely
minimal — but minimal is not the same as lawful without a basis.

### Smaller consequences

- A premium account that lapses to free silently resumes collection. That is
  the intended reading of "part of the free tier", but it is a state change the
  user does not act on and will not be told about.
- `ReceiptQuotaService` now uses the shared `subscriptionTier()` helper instead
  of reading `subscription?.tier` inline, so there is one definition of what
  "free tier" means.
- The specs that encoded default-off had to be rewritten rather than extended.
  Anything exercising the consent lifecycle now uses a premium fixture, because
  a free-tier account cannot express "off" and is useless for testing the
  enable/disable path.
