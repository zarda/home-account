# 48. A dead capability is removed, not guarded

**Status:** Accepted, implemented · **Date:** 2026-08-16 · **Issues:** #239

Reference documentation lives in [../prompts.md](../prompts.md).

## Context

Issue #239 reported that the native-PDF statement reader could emit `NaN`
amounts: `GeminiService.extractTransactionsFromPDF` signed `t.amount` with no
legibility guard, and its own comment claimed its rows "go straight to the
transaction list rather than through the import review" — a fossil from
before the import review existed. Reading the callers showed the claim could
not matter: the method's only caller was the façade's
`extractTransactionsFromPDF`, and the façade method had no production caller
at all. PDF import has gone through `ai-import.service.ts` since the
rasterizer landed — pages become images and every vision-capable provider
reads them through `statementTransactions`, inside the import review. The
native path survived as spec-only code: four Gemini specs, four façade
specs, a registered prompt, a `SINGLE_PROVIDER` exemption, and a
`nativePdf` capability field the façade alone read.

#194 set the precedent (PR #218): a path that is neither wired up nor
deleted is half-present, and half-present is the bug. That removal went
undocumented beyond the PR body; this one retires a public capability field
from the provider contract, which is worth a record.

## Decision

Delete the path end to end: the Gemini method, the façade method, the
optional `extractTransactionsFromPDF?` on `CloudLLMProviderAdapter`, the
`nativePdf` field on `ProviderCapabilities` (now `{ vision }`), the
`pdfStatement` prompt and its registry entry, the `SINGLE_PROVIDER`
exemption, and the two rows in the prompts doc. The single-provider table
drops from three entries to two.

Rejected:

- **Guard-only** — wrapping `t.amount` in a legibility check would have
  fixed the reported symptom inside code nothing calls, leaving the path
  half-present: still specced, still documented, still advertising a
  capability the app never exercises. That is the #194 shape.
- **Wire-up** — routing `importFromPDF` through the native path when Gemini
  is available would mean a second extraction pipeline to keep at parity
  with the rasterized one, rows arriving as signed `RawTransaction`s with
  no currency or category and no import review, and a provider-gated
  behavior difference the rasterizer was built to remove.

## Consequences

- `ProviderCapabilities` is `{ vision: boolean }`. Anything that later needs
  a per-provider capability adds a field with a reader in the same change.
- Gemini the model still accepts PDFs; the app simply never sends one.
  Reinstating the path is a revert plus re-registration — the prompt text,
  specs and exemption all live in this commit's parent.
- The prompts checker now reports 12 prompts, 2 by exemption. The remaining
  exemptions (`receiptSummary`, `receiptItems`) are untouched.

## Things that only became apparent while building

- The checker makes partial removal impossible in the right way: an
  exemption naming an unregistered prompt fails, a doc row naming one
  fails, and a registered prompt with no call site fails — so registry,
  prompt text, exemption and doc rows had to move in the same commit as the
  code.
- One spy line sat outside the obvious blocks: the receipt-scanning
  delegation suite wired `extractTransactionsFromPDF` on the Gemini spy it
  never used.
- The deletion orphaned two imports (`RawTransaction`, `parseDateInput`)
  while the `RawTransaction` *re-export* had to stay — the façade still
  imports the type from `gemini.service` for `categorizeTransactions`.

## Known gaps

- The historical comments explaining why rasterization exists
  (`pdf-raster.utils.ts`, `ai-import.service.ts`) still describe the
  capability gap between providers. They describe the models, not the app,
  and remain true.
- PDF size remains bounded by the rasterizer's page truncation; nothing
  replaces the (never-reachable) unbounded native path.
