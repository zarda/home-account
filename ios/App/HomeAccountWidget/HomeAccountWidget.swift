import SwiftUI
import WidgetKit

@main
struct HomeAccountWidgets: WidgetBundle {
    var body: some Widget {
        HomeAccountMonthWidget()
    }
}

/// Shows the month the dashboard last painted. Every word and figure on it is
/// a string from the snapshot; see `WidgetSnapshot` for why nothing is
/// formatted here.
struct HomeAccountMonthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "HomeAccountMonth", provider: MonthProvider()) { entry in
            MonthEntryView(entry: entry)
        }
        .configurationDisplayName("Home Account")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct MonthEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    var isPlaceholder = false
}

struct MonthProvider: TimelineProvider {
    func placeholder(in context: Context) -> MonthEntry {
        MonthEntry(date: Date(), snapshot: .placeholderSample, isPlaceholder: true)
    }

    /// The gallery preview runs before the app has ever written a file, so a
    /// blank container there is not "signed out" or "no data" — it just means
    /// nobody has opened the app on this device yet. The redacted sample
    /// advertises what the widget looks like once it has something to show,
    /// the same way `placeholder(in:)` does; a *placed* widget with no file
    /// still falls through to the app name alone, below.
    func getSnapshot(in context: Context, completion: @escaping (MonthEntry) -> Void) {
        let snapshot = loadSnapshot()
        if context.isPreview, snapshot == nil {
            completion(MonthEntry(date: Date(), snapshot: .placeholderSample, isPlaceholder: true))
        } else {
            completion(MonthEntry(date: Date(), snapshot: snapshot))
        }
    }

    /// The app reloads the timeline whenever it writes, so the only refresh
    /// the widget schedules itself is the month boundary. That reload can
    /// still run late, so the timeline carries a second entry dated at the
    /// boundary itself — see `WidgetSnapshot.timelineDates` for why one entry
    /// is not enough.
    func getTimeline(in context: Context, completion: @escaping (Timeline<MonthEntry>) -> Void) {
        let snapshot = loadSnapshot()
        let (dates, reloadAt) = WidgetSnapshot.timelineDates(now: Date(), timeZone: .current)
        let entries = dates.map { MonthEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .after(reloadAt)))
    }

    private func loadSnapshot() -> WidgetSnapshot? {
        let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: WidgetSnapshot.appGroupId)
        return container.flatMap { WidgetSnapshot.load(from: $0) }
    }
}

struct MonthEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MonthEntry

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetBackground()
    }

    @ViewBuilder
    private var content: some View {
        if let snapshot = entry.snapshot {
            if entry.isPlaceholder, let figures = snapshot.figures {
                FiguresView(family: family, labels: snapshot.labels, figures: figures)
                    .redacted(reason: .placeholder)
            } else {
                switch snapshot.display(now: entry.date, calendar: .current) {
                case .figures(let figures):
                    FiguresView(family: family, labels: snapshot.labels, figures: figures)
                case .locked:
                    SentenceView(title: snapshot.labels.title, sentence: snapshot.labels.locked)
                case .signedOut:
                    SentenceView(title: snapshot.labels.title, sentence: snapshot.labels.signedOut)
                case .stale:
                    SentenceView(title: snapshot.labels.title, sentence: snapshot.labels.stale)
                }
            }
        } else {
            Text(verbatim: "Home Account")
                .font(.headline)
        }
    }
}

private struct FiguresView: View {
    let family: WidgetFamily
    let labels: WidgetSnapshot.Labels
    let figures: WidgetSnapshot.Figures

    var body: some View {
        if family == .systemMedium {
            HStack(alignment: .top, spacing: 12) {
                month
                VStack(alignment: .leading, spacing: 8) {
                    topBudget
                    nextScheduled
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            month
        }
    }

    private var month: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(labels.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            FigureView(label: labels.spent, value: figures.spent)
            FigureView(label: labels.net, value: figures.net)
            Spacer(minLength: 0)
            Text(labels.updated)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var topBudget: some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionLabel(text: labels.topBudget)
            if let budget = figures.topBudget {
                Text(budget.name)
                    .font(.subheadline)
                    .lineLimit(1)
                ProgressView(value: Double(min(max(budget.percent, 0), 100)) / 100)
                Text(budget.detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text(labels.noBudgets)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    private var nextScheduled: some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionLabel(text: labels.nextScheduled)
            if let next = figures.nextScheduled {
                Text(next.name)
                    .font(.subheadline)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(next.date)
                    Spacer(minLength: 0)
                    Text(next.amount)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            } else {
                Text(labels.nothingScheduled)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

private struct FigureView: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }
}

private struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

private struct SentenceView: View {
    let title: String
    let sentence: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(sentence)
                .font(.subheadline)
        }
    }
}

private extension View {
    /// iOS 17 draws the background and the content margins itself and flags a
    /// widget that does not declare one; earlier systems need both by hand.
    @ViewBuilder
    func widgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) {
                Color(uiColor: .systemBackground)
            }
        } else {
            padding()
                .background(Color(uiColor: .systemBackground))
        }
    }
}

private extension WidgetSnapshot {
    /// Only ever drawn redacted, so its words are shapes, never read.
    static let placeholderSample = WidgetSnapshot(
        version: supportedVersion,
        state: .figures,
        writtenAt: 0,
        monthKey: "2000-01",
        labels: Labels(
            title: "This month",
            spent: "Spent",
            net: "Net",
            topBudget: "Top budget",
            nextScheduled: "Next scheduled",
            noBudgets: "No budgets",
            nothingScheduled: "Nothing scheduled",
            locked: "Locked",
            signedOut: "Signed out",
            stale: "Out of date",
            updated: "Updated today"
        ),
        figures: Figures(
            spent: "0,000.00",
            net: "0,000.00",
            topBudget: TopBudget(name: "Budget", percent: 60, detail: "000.00 / 000.00"),
            nextScheduled: NextScheduled(name: "Scheduled", date: "1 Jan", amount: "00.00")
        )
    )
}
