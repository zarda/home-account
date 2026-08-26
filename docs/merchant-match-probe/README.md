# Merchant-match probe

Measures whether a semantic representation of merchant text actually beats the
0.7 string threshold the recurring detector uses — the measurement
[#296](https://github.com/zarda/home-account/issues/296) asks for before
anything is built, and which it allows to end in the issue being declined.

It runs the app's **real** `normalizeMerchant` and `merchantKeysMatch` over a
labelled corpus of descriptor pairs, then the same corpus through
`gemini-embedding-001` cosine similarity, and reports both against the same
labels.

## Running it

```bash
node docs/merchant-match-probe/probe.mjs              # string ladder only — offline, free
node docs/merchant-match-probe/probe.mjs --embeddings  # also embed; needs a key
node docs/merchant-match-probe/probe.mjs --csv <path>  # add pairs from a real export
node docs/merchant-match-probe/probe.mjs --update      # rewrite baseline.json
node docs/merchant-match-probe/probe.mjs --self-test   # the harness's own metric maths
```

The embedding run needs `geminiApiKey` in `.vscode/environment.ts`, the same
local file the app uses.

**It is deliberately manual and must not go into CI, and it has no npm
script** — an npm script is how a thing ends up in a workflow. The embedding
half spends real API quota. Note that a batch of 100 contents counts as 100
requests against the free tier, so a full run is about 105 and a second run in
the same window will be rate-limited.

It touches nothing of yours: no app, no Firestore, no writes outside this
folder.

## The bar, registered before the run

Recorded in the implementation plan and in
[ADR 0069](../ADR/0069-one-ladder-decides-what-is-the-same-merchant.md) before
any numbers existed, so the result could not be read backwards:

> Embeddings win only if the best-sweep F1 beats the string F1 by **≥ 0.05**
> **and** no family regresses by more than one pair.

The two clauses are not decoration. F1 alone would have passed comfortably;
the family clause is what caught the failure, and the failure is the one that
matters for this feature.

## What it will not let you fool yourself about

It imports the matcher and normaliser out of `src/` and bundles them with
esbuild rather than keeping a copy, the same discipline
[`../model-probe`](../model-probe) uses: a copy drifts, and then the probe
passes while production breaks.

**The corpus is hand-built, and that is its main limit.** 61 pairs chosen to
probe the gaps `normalizeMerchant`'s own comment names — processor prefixes,
legal suffixes, cross-script pairs, abbreviations, CJK variants — plus two
kinds of negative that a naive corpus would omit: two products from one vendor
(`AT&T Wireless` vs `AT&T Internet`), and names that are textually close but
unrelated (`CVS` vs `CVs Nails`). Every row carries a `family` and a `why` so
a reviewer can disagree with one row rather than with the number.

Choosing the pairs is choosing part of the answer. Disagree with a row by
editing `fixture.json` and re-running — that is what it is for.

**`--csv` never writes a baseline.** Pairs from a real export are printed and
not recorded: a baseline built from a file nobody else has is a permanent
unverifiable number in the repo. `--csv` with `--update` is refused.

**Embedding scores are not perfectly stable.** They move with the model
version, which is why `baseline.json` records the model id. Treat a small
delta as noise and re-run before believing it.

**A label is a claim.** The `already-matched` and `already-refused` families
assert the string ladder handles those pairs today; one row was mislabelled on
the first pass and the probe caught it. Re-verify rather than assume when
adding rows.

## The result

See `baseline.json` for the recorded run and
[ADR 0069](../ADR/0069-one-ladder-decides-what-is-the-same-merchant.md) for
the decision it produced.
