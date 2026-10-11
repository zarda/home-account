# 176. Every category list breaks a tie by id over cent-rounded totals

**Status:** Accepted, implemented · **Date:** 2026-10-11 · **Issues:** #488

Reference documentation lives in [../rag-insights.md](../rag-insights.md),
[../smart-search.md](../smart-search.md),
[../dashboard.md](../dashboard.md) and [../insights.md](../insights.md).

[0171](0171-second-copies-fold-into-one-copy-of-each-helper.md) gave the
category folds one order: larger total first, each total rounded to the
cent, and an exact tie by category id. Three lists kept an order of their
own, and they now follow it. A fourth list, the unusual amounts, ranks a
tie by the row's id.

It closes a gap of 0171.

- **0171's *Remaining folds, by design or deferred*** named the Reports
  page's Categories tab, `getPeriodCategoryTotals` as it reaches
  `computeCategoryDeltas`, and the search's `topCategories`. Each of the
  three now ranks figures rounded to the cent and breaks an exact tie by
  category id. `getPeriodCategoryTotals` itself stays unrounded and
  unsorted, as the issue proposed: its readers look a category up by id,
  and its order no longer reaches anything.

## Context

0171 moved six category folds onto `transaction-aggregation.utils.ts`.
Their rule lives in `compareCategoryTotals`: larger total first, then
`compareIds` on the category id, which compares by UTF-16 code unit. Each
fold rounds its totals with `roundMoney` before it sorts. #488 found the
three lists 0171 had left out still sorting by size alone, over unrounded
totals:

- **The Reports page's Categories tab.** `category-breakdown.component.ts`
  folded the side the Expense/Income toggle picked into a local `Map` and
  sorted it by total. 0171 left it because the expense-only helpers drop
  income. `chartTotals` hands that order to the reused
  `SpendingChartComponent`, whose donut and legend keep six categories. For
  the same month, the dashboard's Spending by Category card, the Spending
  Analysis tab and the report PDF listed a tie by id, and this tab could
  list it the other way.
- **The category changes.** `computeCategoryDeltas` ranked by the size of
  the change alone. Two readers take its order. The *Category changes vs.
  previous period* block of the AI summary's grounding keeps five changes,
  or ten on the Deep tier. The Transactions page's new-category chip names
  the first new category in it.
- **The search's top categories.** `topCategories` rolls each category up
  to its parent, which no shared helper does. It keeps as many categories
  as the question asked for: three when it names no number, and ten at
  most. The answer is saved to the history, and a Refresh writes it back.

Every window these lists read is queried `date desc`. A `Map` keeps the
order its keys were first set, and the sorts are stable, so a tie followed
whichever category's newest row arrived first. Editing a row's date could
swap two tied categories, and a tie at a cap decided which category
appeared at all. No figure was wrong.

None of the three rounded either. `0.1 + 0.2` is `0.30000000000000004`, not
`0.3`, so two totals that print the same could still rank apart on noise
far below a cent.

Planning found a fourth list of the same kind. `computeAmountAnomalies`
ranked the unusual amounts by value alone. The Transactions page shows at
most two anomaly chips, one per category, so a tie at that cap decided
which category got a chip. Through the categories the chips have already
used, it also decided whether the new-category chip could name that
category.

Two facts kept the fix small:

- **The precedent already existed.** `compareSnapshots`, in
  `insight-snapshot.utils.ts`, ranks the same kind of change. It rounds the
  change with `roundMoney` and ends its sort in `compareIds`.
- **The one fold that keeps income was already shared.**
  `groupByCategoryAndType` rounds each total and ranks each side by
  `compareCategoryTotals`. The CSV category summary reads it.

The reports page also computed two members that nothing read: a
`categoryTotals` fold through `groupExpensesByCategory`, and a
`categoriesMap`.

## Decision

**Every list of categories ranks figures rounded to the cent, larger first,
and breaks an exact tie by category id, as 0171's folds do. The unusual
amounts are a list of rows whose cap decides which category gets a chip,
and they break a tie by the row's id. The Categories tab folds through
`groupByCategoryAndType`. The category changes and the search keep their
own folds and take the rounding and the tie from the shared helpers. The
reports page's two unread members go, one commit each.**

Each commit is cited by its subject.

### The Categories tab

`fix(reports): the Categories tab lists a tie in category id order` drops
the tab's local fold. `categoryBreakdown` maps
`groupByCategoryAndType(this.filteredTransactions(), t =>
this.toBaseCurrency(t))` to its rows.

- **The input is already one side.** `filteredTransactions()` holds the
  side the toggle selects, so every row the fold returns is on that side,
  and the fold's expense-then-income order never comes into play. No second
  filter was added.
- **The fold rounds and ranks.** Each total is rounded to the cent, larger
  first, and an exact tie goes by category id.
- **Name, icon, colour, share and average are still worked out per row.**
  - The share is `row.total / total * 100`, still guarded by `total > 0`.
  - The average is `row.total / row.count`. A fold row always counts one
    row or more, so its guard went.
- **The header's `total()` stays unrounded.** A share divides a rounded
  total by an unrounded side total, and the difference sits below what the
  tab prints.
- **`chartTotals` is unchanged.** It maps `categoryBreakdown()`, so the donut
  and its legend inherit the order. A tie at sixth place gives the last
  slice to the lower id.

In the spec, *a tie between categories* checks both sides of the toggle,
and also *counts a total that differs only by float noise as a tie*. The
real-template case *renders a tie in category id order in the panels and
the donut* reads `.category-name` and the chart's input. A new smoke,
`reports-categories.smoke.spec.ts`, *lists two categories with equal totals
in category id order, on each side of the toggle*. It opens
`/reports?tab=categories` against the emulators, reads the accordion and
the legend, then clicks the toggle and reads the income side.

### Two members nothing read

- `refactor(reports): the page stops folding category totals nothing reads`
  removes `ReportsComponent.categoryTotals` and its import specifier. No
  template, file or spec read the fold.
- `refactor(reports): the page stops building a category map nothing
  reads` removes `categoriesMap`, and the `Category` import it was the only
  use of.

They are two removals, so they are two commits
([0048](0048-a-dead-capability-is-removed-not-guarded.md)). The page keeps
`categories` and its subscription, which feed the tabs.

### The category changes

`fix(insights): a tie in the category changes ranks by id over cent-rounded
changes` changes `computeCategoryDeltas`.

- **Three figures are rounded.** `current` and `previous` go through
  `roundMoney`, and `change` is `roundMoney(current - previous)`. Rounding
  the two totals alone is not enough: `0.3 - 0.1` is
  `0.19999999999999998`, which would still rank below a plain `0.2` that
  prints the same.
- **The sort** is `Math.abs(b.change) - Math.abs(a.change) ||
  compareIds(a.categoryId, b.categoryId)`, on one line, so the issue's grep
  finds the tie-break on the hit's own line.
- **`isNew` reads the rounded `previous`.** A previous total under half a
  cent now rounds to `0` and counts as new (see *Things that only became
  apparent while building*).
- **The filter stays.** `Math.abs(change) > 0.005`, over a change rounded
  to the cent, keeps every change of a cent or more.
- **`getPeriodCategoryTotals` is not touched.**

One change serves both readers, the summary's block and the chip. The
cases cover a grower against a category that fell to nothing, `food` going
from `0.1` to `0.3` against `pets` new at `0.2`, and a tie across the cap.
A pin holds that a larger change still outranks a lower id, and a further
case *rounds the totals and the change to the cent*. The chips' *names the
lower category id when two new categories tie* and the grounding's *should
list a tie in the category changes in id order* hold the two readers.

### The search's top categories

`fix(search): a search's top categories rank a tie by id` changes
`topCategories` in `NlSearchService`. The roll-up to the parent and the
fold into a `Map` stay as they were. Each entry is then mapped to
`{ categoryId, total: roundMoney(total) }`, sorted with
`compareCategoryTotals`, and cut to the question's limit.

- **`answer.value` is rounded too.** It reads the first group's total.
- **A Refresh rewrites an older record's groups rounded.** `recordAnswer`
  and Refresh both save `groups` as computed
  ([0016](0016-aggregate-answers-persist-as-snapshots-that-refresh-locally.md)).

The new cases go through `replayAggregate`, which cannot fall back to a
keyword search, so a wrong answer fails on its groups:

- *ranks a tie among parents at the limit by category id, not by row
  arrival*;
- *ranks a tie between cent-rounded totals by id when float noise
  separates the sums*: `transport` at `0.1`, plus its child
  `transport_taxi` at `0.2`, against `pets` at `0.3`, with a limit of one,
  gives `pets`.

The existing roll-up case gains `expect(result.kind).toBe('answer')` before
its guarded block, so a fallback can no longer pass it without checking
anything. In the search smoke, *ranks a tie among parents at the limit by
category id* writes September rows to the emulator. The child of the higher
parent is dated later, so a `date desc` read delivers it first.

### The unusual amounts

`fix(insights): an anomaly tie ranks by row id` ends
`computeAmountAnomalies`' sort in `|| compareIds(a.transaction.id,
b.transaction.id)`.

- **The tie goes to the row's id, because the list ranks rows.** A row's
  id does not change between loads.
- **The chips walk the list largest first**, taking one chip per category
  up to two. At that cap the row id now decides which category goes
  without, and so whether the new-category chip may name it.
- **The summary's *Unusual amounts* block reads the same order.**
- **The value is not rounded.** It is one row's base-currency amount, not
  a sum (see *Known gaps*).

The cases are *ranks equal amounts by row id*, *keeps the lower id when
the cap falls between the tied pair*, and a pin that a larger amount still
outranks a lower id. In the chips spec, *names the categories of the
lowest row ids when anomalies tie at the cap* holds the cap.

### What stays

- **The top expenses keep arrival order on a tie.** `computeTopExpenses`,
  and the five largest expenses the provider base lists in the
  spending-summary prompt, sort by amount alone. A tie there decides
  which of two equal rows is named. No list of categories, cap or chip
  reads that order, so it moves no category.
- **The search's untyped scope adds both sides.** A scope with no `type`
  adds income and spending into one total per category, because
  `applyScope` filters by type only when the scope has one. That matters
  only for a category of type `both`, and no default category has that
  type. Whether it is right is a question about what the answer means, not
  about its order.

### The tie specs fail first only one way round

On the code before this change, a tie kept the function's own input order:
rows arrive `date desc`, a `Map` keeps first-set order, and the sorts are
stable. A tie spec therefore fails first only when, without the tie-break,
the function would put the higher id first. Every case here is built that
way:

- **The higher id arrives first in the function's own order.**
  - On the Categories tab and in the search, that is row order. In the
    smokes the higher id's row is dated later, so the `date desc` window
    delivers it first.
  - In the anomalies, the candidates are grouped by category in the order
    the input holds them.
  - The anomaly rows carry literal ids, `row-a` to `row-c`, arriving
    highest first, never `generateId`'s counter.
- **Float noise ranks the lower id second unless the figures are rounded.**
  In a sum (the Categories tab and the search), the higher id's rows add to
  `0.1 + 0.2`, which is just above the lower id's single `0.3`. In the
  category changes, the noise is a difference on the lower id: `food` going
  from `0.1` to `0.3` changes by `0.19999999999999998`, just below `pets`
  new at `0.2`. Noise that ranked the lower id first would prove nothing. On
  the Categories tab the lower id's row also arrives first, so only the
  unrounded total can put the higher id ahead. A fix that broke the tie
  without rounding still fails that case.
- **In `computeCategoryDeltas`, a fallen category must hold the lower
  id.** Its ids come in its own order: the categories with spending this
  period, in row order, and then those found only in the previous period.
  A category that fell to nothing therefore always comes after a grower.
  So the case has `transport` grow by 30 and `food` fall by 30 to nothing,
  and expects `['food', 'transport']`.

A case that passed before the change is labelled a pin: a larger total,
change or amount still outranks a lower id.

## What was rejected

- **Sorting `getPeriodCategoryTotals`' list instead.** It would settle only
  the ties among categories that fell to nothing. Those with spending this
  period would still follow the current window's order.
- **Breaking a tie by category name.** Names are translated, so the order
  would change with the language. `localeCompare` also depends on the
  runtime's ICU data, which is why `compareIds` exists
  ([0002](0002-insights-and-monthly-snapshots.md)).
- **Rounding the two totals and not the change.** `0.3 - 0.1` is
  `0.19999999999999998`.
- **Keeping the page's `categoryTotals` and passing it down to the tab.**
  The issue offered that. But the page's fold held expenses only, and the
  tab folds whichever side the toggle picks, so the tab would still have
  needed a fold of its own beside it.
- **A shared fold that rolls up to the parent.** Only the search rolls up.
  It takes the rounding and the comparator from the shared helpers, so the
  rule still has one copy
  ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).
- **A tie-break for the top expenses.** See *What stays*.

## Consequences

- **What a reader sees change:**
  - **The Categories tab.** An exact tie lists in category id order on
    both sides of the toggle: in the accordion, in the donut and in its
    legend. That matches the dashboard's Spending by Category card, the
    Spending Analysis tab and the report PDF. The tab's per-category totals
    are rounded to the cent.
  - **The AI summary's *Category changes* block.** A tie lists by id, a tie
    at the cap keeps the lower id, and each figure is stated to the cent. A
    category whose previous total was under half a cent reads *new this
    period*.
  - **The Transactions page's chips.** The new-category chip names the
    lower id of two new categories at the same total. At the two-chip cap,
    the anomaly chips go to the categories of the lower row ids.
  - **A search's top categories.** A tie lists by id, the lower id is kept
    at the limit, and each total is stated to the cent. A Refresh rewrites
    an older record's groups rounded.
- **The issue's grep** now prints:

  ```
  $ grep -rn -A1 "b.total - a.total\|Math.abs(b.change) - Math.abs(a.change)" src/app --include='*.ts' | grep -v spec
  src/app/core/utils/transaction-aggregation.utils.ts:107:  return b.total - a.total || compareIds(a.categoryId, b.categoryId);
  src/app/core/utils/transaction-aggregation.utils.ts-108-}
  --
  src/app/core/utils/transaction-aggregation.utils.ts:281:    .sort((a, b) => b.total - a.total || compareIds(a.country, b.country));
  src/app/core/utils/transaction-aggregation.utils.ts-282-
  src/app/core/utils/insight-snapshot.utils.ts:180:    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)
  src/app/core/utils/insight-snapshot.utils.ts-181-      || compareIds(a.categoryId, b.categoryId))
  src/app/core/utils/spending-insight.utils.ts:131:    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || compareIds(a.categoryId, b.categoryId))
  src/app/core/utils/spending-insight.utils.ts-132-    .slice(0, cap);
  ```

  - Every hit holds `compareIds`, on its own line or, for
    `insight-snapshot.utils.ts`, on the line after it.
  - Neither `category-breakdown.component.ts` nor `nl-search.service.ts`
    appears.
  - The anomaly sort is outside the grep's pattern. A grep for
    `b.value - a.value` prints it with `compareIds`, and
    `computeTopExpenses` without it, as *What stays* says.
- **Nothing else moves.** No rules, index, function, analytics event or
  catalog key changes. A stored answer keeps its figures until it is
  refreshed.
- **The initial bundle.**
  - The chunk of `rag-context.service.ts`, which holds
    `spending-insight.utils.ts`, took 124 bytes for the cent-rounded,
    id-tied category changes and the anomaly tie.
  - `nl-search.service.ts` is in the entry chunk. Its rounded, id-tied sort
    is inside that chunk's net change, which
    [0174](0174-a-postings-digest-carries-a-salt-only-its-rule-holds-and-the-drain-reads-once.md)
    records.
  - The Categories tab and the reports page are lazy.
  - The catalog subscription in the search dialog, which is eager through
    the header, took 118 bytes.

  [../performance.md](../performance.md) records the branch's measured
  figure.
- **The browser run saw it** in the emulator venue on 2026-10-11, as
  journey 92.
  - **The Categories tab.** `/reports?tab=categories` listed Food & Drinks
    before Health & Wellness, journey 88's tie at $35, in the accordion and
    the legend, as the dashboard does.
  - **An income tie.** Two income rows of 100 were seeded over REST, the
    higher id dated later. The income side listed Investments before
    Rental & Property.
  - **The chip.** Two new categories at 150 were seeded the same way. The
    new-category chip named Gifts & Donations, not Pets.
  - **A stored answer.** A `topCategories` answer seeded with stale groups
    refreshed to bills, gifts, pets, with the tie at 150 in id order. That
    run also found the defect below. After its fix, the same Refresh stored
    bills at 2306.3, with its child `bills_electricity` rolled in, and the
    card named all three groups.

## Departures from the issue

- **A fourth list.** The issue named three. `computeAmountAnomalies` joined
  them, because its tie at the two-chip cap decided which category got a
  chip. Its tie goes to the row's id, since it ranks rows.
- **Two removals, not one.** The issue named the page's unread
  `categoryTotals`, to be passed down or removed. It was removed. So was
  `categoriesMap`, which nothing read either, in a commit of its own.

## Departures from the plan

- **The share keeps its guard.** The plan wrote the share as
  `row.total / total * 100`. An all-zero side would make that `NaN`, so
  `total > 0 ? … : 0` stays.
- **The Categories tab's float-noise case also puts the lower id's row
  first.** The plan put only the noise on the higher id. With the lower id
  also arriving first, arrival order alone would list it first, so the case
  fails on the rounding and nothing else.

## Things that only became apparent while building

- **Rounding `previous` changed what `isNew` must read.** Read from the raw
  figure, a previous total of `0.004` is not new, yet it is stated as `0`.
  The grounding's line for a category that is not new divides the change
  by `previous`, so it would have read *up Infinity%*. `isNew` reads the
  rounded figure, and such a category reads *(new this period)*. A pin,
  *reads isNew from the cent-rounded previous total*, holds it.
- **The search history and the search dialog never loaded the category
  catalog.** The browser run found it while refreshing a stored answer.
  - `CategoryService.categories` is filled only by a `loadCategories()`
    subscription. Each page that reads the catalog opens its own, and the
    signal keeps the last list after it closes.
  - Neither `/search-history` nor the global search dialog opened one. So
    `NlSearchService` saw an empty list on a direct load of the history
    page, or when the dialog was opened first from a page that loads no
    catalog: `/household`, `/ai`, `/data` or `/about`.
  - With the empty list, the answer card named every group *Other*.
  - A Refresh rolled nothing up to its parent and stored the groups
    un-rolled. In the browser, `bills` was stored at 2210, without its
    child `bills_electricity` at 96.30.
  - Intent parsing was handed no categories, and a category scope took in
    none of its children.

  `fix(ui): the search history and the search dialog load the category
  catalog` has both hosts subscribe `loadCategories()` for their lifetime,
  the per-page pattern the transactions and reports pages follow. The
  history spec's catalog stub is now an empty signal the subscription
  fills, as on a direct load. The old stub always returned the catalog,
  which is why no unit case saw the defect. New cases hold that each host
  subscribes to the catalog and releases it, and that an expanded answer
  names its group.

## Known gaps

- **A search made before the catalog's first snapshot still sees an empty
  list.** The dialog and the history page subscribe when they open, but
  `NlSearchService` reads the catalog's signal when it is called and waits
  for nothing. A question submitted before the first snapshot arrives is
  interpreted, scoped and rolled up without the catalog, and the dialog
  stores that answer's un-rolled groups. A Refresh on the history page in
  that window rolls up nothing either and saves what it got, though it
  needs a record listed and expanded first. The window is not always short.
  The first snapshot comes from the persistent cache only when the cache
  holds a result for the query. An account with no custom categories, whose
  catalog is all code defaults, on a device that has never synced that
  query, has none, so the first snapshot waits for the server, or, offline,
  until the SDK decides it is offline. Goals and budgets already fall back
  to a one-shot read when their signal is empty; doing the same for the
  catalog is a follow-up for the owner, and no issue is filed yet.
- **Answers written while the catalog was empty keep what they hold.** A
  record written or refreshed before the fix, on the history page or in
  the dialog, keeps its un-rolled groups until it is refreshed again.
  Nothing migrates them.
- **The unusual amounts compare unrounded values.** Two rows in the base
  currency at the same amount tie exactly. Two converted rows that print
  the same can still rank by the noise of their conversions.
