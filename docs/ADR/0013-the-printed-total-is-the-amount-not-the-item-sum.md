# 13. The printed total is the amount, not the sum of the items

**Status:** Accepted, implemented · **Date:** 2026-08-05 · **Issues:** #226

Reference documentation lives in [../receipt-import.md](../receipt-import.md). This
record keeps the decision and the reasoning.

## Context

The item prompts do not ask for totals, and that was deliberate.
`multiImageReceipts` and `receiptItems` return one row per purchased item so
that several photos of one long receipt can be grouped by `receiptId` and
deduplicated across their overlapping edges. A tax line or a `TOTAL` row
arriving in the same array is a row the deduplicator would have to recognise as
not-an-item, and it has no way to. So the totals stayed out.

That left consolidation with nothing else to work with.
`consolidateReceiptItems` added the group up and called the sum the
transaction's amount. On a receipt where the items are the whole story, the sum
is right. On every other receipt it is not — consumption tax, a service charge,
a member discount taken off the subtotal, a rounding line all sit *below* the
item list, and none of them were in the sum. Items adding to 3,800 under a
printed total of 4,180 were imported as 3,800 — the number the user is most
likely to check against a bank statement was the one guaranteed to be wrong.

The total was never actually absent from the response. `receiptDetails`
reproduces the receipt line by line, printed total included, and that field is
prose: it exists to be read on the transaction, not parsed.

The last-resort regex parser had the opposite failure. It picks the largest
figure in the strongest evidence tier it found, which is the total on all but
the odd receipt — until the receipt was paid in cash. Then the largest figure is
the note handed over, 500 against a bill of 481, and the parser returned it with
the tier's full confidence, because the evidence for the figure genuinely was
good. Only the interpretation was wrong.

## Decision

**The amount on a receipt transaction is the figure the receipt printed.**
Everything else — the item sum, the largest number on the page — is an estimate
of that figure, and wherever the app falls back on an estimate it says so on the
row rather than in a comment.

### Ask for the total as its own field, rejecting prose parsing and pseudo-items

Both item prompts now request `receiptTotal`, once per `receiptId` group, on the
last item of the group, from a shared `RECEIPT_TOTAL_FIELD` fragment. That is
the convention `receiptDetails` already uses, so the model is asked for one more
value in a place it is already answering rather than for a new kind of answer,
and both prompts ask for it in identical words. All four normalizers — Gemini's
two, OpenAI's and Claude's — map it through `readReceiptTotal`, which takes a
magnitude, coerces a numeric string, and treats zero and unparseable text as
nothing reported.

Rejected: recovering the total from `receiptDetails`. The prose is reproduced in
the receipt's own script on purpose ([0008](0008-universal-receipt-language-support.md)),
so reading a number out of it means matching the word for "total" in every
language a receipt might be printed in. That is the per-language pattern table
this feature exists not to have, rebuilt one layer higher.

Rejected: a total row disguised as an item, carrying the figure in the array
that already exists. It costs no new field and breaks two things at once. The
deduplicator merges same-valued rows across overlapping photos, so two photos of
one receipt yield one total row or two depending on where the crop fell; and
every consumer that treats the array as a list of purchases — the sum here, the
itemized note the wizard shows — gains a phantom item worth the whole receipt.

### Prefer the reported total, rejecting silent trust in either figure

`consolidateReceiptItems` uses the reported total when the group carries one.
When it does not, the item sum stands in and `fieldConfidence.amount` is set to
0.5, below the 0.7 verify threshold, so the review table marks the amount. When
the reported total and the item sum disagree by more than 50% of the larger of
the two, the total is still what is used *and* the row is flagged the same way:
one of the two figures was misread, the printed one is the likelier of the pair
to be right, but not so much likelier that the disagreement should be swallowed.

A tighter tolerance was tempting and is wrong for this data. Tax and service
charges routinely put 10–20% between the two figures on a correct read, and a
threshold that flags those flags almost every restaurant receipt. What is left
above 50% is not a discrepancy, it is one of the two numbers being a different
kind of thing.

Rejected: expressing the same doubt by capping the row's `confidence`. It is one
line in the same object and it looks equivalent. It is not: row confidence
averages into the score `AIStrategyService` compares against `USABLE_CONFIDENCE`
(0.4) to decide whether the other engine is worth spending, and it is carried
onto the wizard row as `categoryConfidence`, which colours the category
suggestion. Lowering it to say "this amount is a guess" would re-run an
extraction that was fine and tell the reader the category is doubtful.
Confidence *in a field* and confidence *in a result* are separate claims, and
`FieldConfidence` already exists to hold the first.

### Demote arithmetic-explained round maxima, rejecting keyword tables

The parser keeps largest-wins, with one correction that needs no vocabulary. The
winning figure M is treated as cash tendered when M is tender-shaped — a whole
number divisible by five, the way notes and coins come — and two other
candidates in the same tier satisfy x + y ≈ M with x ≥ y, the printed total plus
the change. The largest such x becomes the amount, at 0.75× the tier's
confidence, which puts even a top-tier read under the verify threshold.

The demotion stands down when x is itself tender-shaped. {450, 50, 500} is a
total of 450 with 50 change from a 500 note, and it is equally a subtotal of 450
plus 50 of tax printed as a total of 500. The two readings produce the same
three numbers, and nothing in the arithmetic separates them, so largest-wins
holds and the receipt is left as it was rather than moved to the other guess.

Rejected: a keyword table — TOTAL, 合計, TOTAL À PAYER against CASH, 現金,
CHANGE. It reads better on the receipts one thinks of while writing it, and this
parser is the fallback for exactly the receipts the models could not read, which
skew towards the scripts such a table would miss. Arithmetic is the same in
every language; that is the whole reason this parser reads structure rather than
words.

## Things that only became apparent while building

**The parser had no per-field confidence channel at all.**
`ProcessedTransaction.fieldConfidence` documented itself as unreportable on that
path — "the regex parser has no way to know" — while `readAmount` had been
computing precisely that number for as long as it had tiers, and folding it into
the weighted row confidence where nothing could see it again. Surfacing it cost
a field on `ParsedReceiptText` and one line in the caller. The consequence is
larger than the change: every tier-2 and tier-3 read now flags the amount, since
0.5 and 0.3 are both under the threshold. That is correct — a figure that was
not printed beside a currency mark is a guess — but it visibly increases how
often a natively parsed row is marked, and that is accepted rather than
overlooked.

**Nothing on the multi-image path carried `fieldConfidence` at all.** Four
mappings sit between consolidation and the review table — `AIStrategyService`
building `ProcessedTransaction`s out of the consolidated groups,
`AIImportService`'s strategy passthrough and its own item path, and
`CameraCaptureComponent` — and not one of them copied the field. The preview
table's chip and its tooltip have been there since `FieldConfidence` was
introduced; on this path they had never had anything to render, so a flag set in
consolidation would have died in the layer directly above it.

## Known gaps

{450, 50, 500} keeps largest-wins, as above: where the printed total is itself a
round figure and the receipt was paid in cash, the parser still returns the
note. It is the documented ambiguity rather than a bug, but round totals and
cash payment coincide often enough that this is a real miss and not a
theoretical one.

The mirror case demotes when it should not: two item prices adding up to a round
printed total, the larger of them not itself round — 301 and 199 under a total
of 500 — read as total plus change, and the parser takes 301. The net is a
flagged row, the same outcome as the case the rule exists for, which is the only
reason the trade is worth making at all.

A model that never returns `receiptTotal` flags every row on the item pipeline.
The fallback is meant to be visible, but a provider that quietly ignores the
field turns the flag into wallpaper, and nothing measures how often it arrives.

Parser date confidence is still unreported. `readDate` grades its read the same
way `readAmount` does, `ParsedReceiptText` exposes only the amount, and
`fieldConfidence.date` stays undefined on the native path — so a date the parser
guessed at looks exactly like one it read.

The foundation-models path reports no per-field confidence either. When Apple
Intelligence is available it structures the OCR text itself, returns no grades,
and never runs the regex parser — so on the pipeline that is *preferred* on
recent iPhones, neither the demotion nor the amount flag exists.
