# Dates and period windows

Every date boundary in the app is computed by
`src/app/core/utils/transaction-date.utils.ts`. Nothing else builds one. That
rule is the whole of
[ADR 0026](ADR/0026-every-period-window-comes-from-one-helper.md): four
confirmed bugs (#167, #171, #173, #174) were each a defect in a private copy of
arithmetic this module already had.

## Local parts, always

A date is read and written through its **local** parts — `getFullYear()`,
`getMonth()`, `getDate()` — never through `toISOString()` and never by parsing
a date-only string with `new Date(...)`.

`new Date('2026-08-01')` is UTC midnight by language specification. West of
UTC that instant is 31 July, so a receipt dated the 1st filed into the previous
month's budget, comparison and snapshot; east of UTC the export leg produced
the opposite shift. That is #174, and the fix is that `parseDayKey` /
`parseDateInput` are the only doors a date-only string comes through.

The consequence to keep in mind: day-of-week and day-of-month are a function of
the runtime's IANA zone. Anything that *persists* one of those results records
the zone alongside it (the insight snapshots do).

## Keys

| Helper | Shape | Notes |
|---|---|---|
| `dayKey(date)` | `2026-08-01` | Sorts lexicographically = chronologically |
| `monthKey(date)` | `2026-08` | Same |
| `parseDayKey(value)` | `Date \| null` | Exact inverse of `dayKey`; rejects `2026-02-31` |
| `parseMonthKey(key)` | `{ year, month } \| null` | `month` is 0-11, to match `Date` |
| `parseDateInput(value)` | `Date \| null` | For untrusted input: model JSON, CSV cells, queued rows |

`parseDayKey` rejects a well-shaped date that does not exist rather than
falling through to the platform, which does not reject it either —
`new Date('2026-02-31')` is 3 March in V8. Having recognised the format, a date
the receipt never named is better reported than quietly moved.

## Windows

A `DateWindow` is `{ start, end }`, **inclusive at both ends**. Every window
this module returns opens at local midnight and closes on
`23:59:59.999` of its final day.

| Helper | Window |
|---|---|
| `startOfDay` / `endOfDay` | One local day |
| `monthWindow(date \| { year, month })` | One calendar month |
| `yearWindow(year)` | One calendar year |
| `weekWindow(date)` | Monday through Sunday |
| `periodWindow(option, now, custom?)` | A named selector period |
| `clampWindowToNow(window, now)` | Any window, narrowed to end-of-today |
| `previousPeriodWindow(selection, now)` | The dashboard's comparison window |
| `budgetPeriodWindow(period, anchor, now)` | The budget period containing `now` |

Shifting is done with `addDays` and `addMonths`, both of which rebuild from
local parts. Adding `86_400_000` ms lands an hour out across a DST transition,
which is enough to move a date to the neighbouring day; `wholeDaysBetween`
normalises to UTC midnight before subtracting for the same reason.

`addMonths` clamps the day to the length of the month it lands in, so
31 January plus one month is 28 February. Shifting first and clamping after
cannot work — the overflow has already spilled into March before anything reads
February's length. That is #167.

### The selector emits full calendar bounds

`periodWindow` is the origin of every period in the app, and it does **not**
care whether the period has finished: `thisMonth` on the 3rd still runs to the
end of the month. Consumers with to-date semantics narrow it themselves, with
`clampWindowToNow`.

That split is deliberate. A window that silently stopped at today would make
"this month" mean something different depending on when it was read, and the
reports tab genuinely wants the whole month for its month-over-month axis.

### The comparison window truncates

The dashboard clamps its current window to end-of-today, so its *comparison*
window has to be cut to the same elapsed span. Comparing part of this month
against all of last month reads as a large false decline for roughly the first
25 days of every month, and the generated summary asserts it. That is #173, and
`previousPeriodWindow` is where the truncation lives — it shifts the clamped
end back a whole number of months with `addMonths`, so a window clamped to
31 March compares against 28 February.

A period that has already closed keeps its whole calendar bounds; there is
nothing to truncate.

### Budgets anchor on their start date

Budget periods are not calendar-aligned. A monthly budget started on the 15th
runs the 15th to the 14th, a weekly budget started on a Tuesday runs Tuesday to
Monday, and a yearly budget runs from its start month and day.

The anchor day is clamped to the length of the month being tested **before** it
is compared against today. Comparing against a raw day 31 in February rolled
the period back to January and ended it on 27 February — so 28 February
belonged to no period at all, and an expense that day counted against nothing
and raised no alert. That is #171. The end of a period is computed as one
millisecond before the next one opens, rather than as a second date, so
consecutive periods cannot overlap or leave a gap.

`budgetPeriodKey` labels a period: `2026-W33`, `2026-08` or `2026`.

## Where the boundaries are asserted

- `transaction-date.utils.spec.ts` — the unit specs, including one regression
  spec per issue. Run under `TZ=America/New_York` and `TZ=Asia/Tokyo` by
  `npm run test:dates`, because at offset 0 a local bound and a UTC bound are
  the same instant and no assertion can tell them apart.
- `period-window.smoke.spec.ts` — the same bounds against the Firestore
  emulator, where a real `Timestamp` comparison decides what is inside a
  period. Seeded on the first millisecond of a month, the last, and one
  millisecond past the end.

Two greps should stay empty outside this module and its specs:

```
grep -rn "23, 59, 59\|setHours(23" src/app --include='*.ts'
grep -rn "getMonth() + 1, 0" src/app --include='*.ts'
```

## Known gaps

- **Weekly budgets label with an ISO week but window on their own weekday.**
  `budgetPeriodWindow('weekly', …)` runs from the anchor's day of the week,
  while `budgetPeriodKey(…, 'weekly')` is an ISO week number, which always
  starts on a Monday. The two only line up for a budget that started on a
  Monday. The label is display-only in `BudgetSummary` and is never parsed or
  persisted, so this is a cosmetic mismatch — preserved rather than corrected,
  because changing it would move a rendered value under cover of a refactor.
- **The weekly label is unpadded.** Week 5 renders `2026-W5`, not `2026-W05`,
  so a set of them does not sort lexicographically. Same reasoning as above.
- **The upper bound widened by 999 ms.** The period selector and the dashboard
  used to emit `23:59:59` flat while the utils used `.999`, so the same named
  period had two different ends depending on who asked. Unifying on `.999` is
  strictly more inclusive: a transaction posted in the final second of a month
  is now inside the month it belongs to.
- **A yearly budget anchored on 29 February moves to 1 March** in a common
  year, because that arm builds its date directly rather than through
  `dateAtClampedDay`. Pre-existing behaviour, kept as it was; the monthly arm
  does clamp.
- **`defaultBudgetStart('weekly', …)` is Sunday-based** while `weekWindow` is
  Monday-based. The former is a suggested anchor the user can overwrite, not a
  reporting boundary, so the two are not required to agree — but it is easy to
  read as an inconsistency.
- Nothing here is calendar-aware beyond weekends: `DEFAULT_WEEKEND_DAYS` is
  Saturday and Sunday for all three shipped locales, and there are no
  public-holiday concepts.
