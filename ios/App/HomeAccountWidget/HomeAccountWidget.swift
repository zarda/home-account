import SwiftUI
import WidgetKit

@main
struct HomeAccountWidgets: WidgetBundle {
    var body: some Widget {
        HomeAccountMonthWidget()
    }
}

/// Shows the month the dashboard last painted. Every figure, and every word
/// but the app's name, is a string from the snapshot; the name comes from the
/// extension's own `Localizable.strings` (the `app.title` key, read as
/// `appName`). See `WidgetSnapshot`
/// for why nothing is formatted here.
struct HomeAccountMonthWidget: Widget {
    /// The app's name: what the gallery lists the widget under, and what the
    /// widget shows before there is a snapshot to read. A key of the
    /// widget's own `Localizable.strings` (en, ja, zh-Hant), so iOS names the
    /// app in the device's language; `npm run i18n:check` holds each table
    /// equal to the web catalog it mirrors.
    static var appName: LocalizedStringKey { "app.title" }

    /// The Lock Screen families arrived with iOS 16 and the target still
    /// builds for 15.6, so they join the two home-screen sizes only where the
    /// system knows them.
    static let families: [WidgetFamily] = {
        var families: [WidgetFamily] = [.systemSmall, .systemMedium]
        if #available(iOSApplicationExtension 16.0, *) {
            families += [.accessoryRectangular, .accessoryCircular]
        }
        return families
    }()

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "HomeAccountMonth", provider: MonthProvider()) { entry in
            // Once, around every family and state: a tap anywhere on the
            // widget opens the dashboard.
            MonthEntryView(entry: entry)
                .widgetURL(WidgetSnapshot.tapURL)
        }
        .configurationDisplayName(Self.appName)
        .supportedFamilies(Self.families)
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

/// Lays out the face `WidgetSnapshot.face(of:isPlaceholder:now:calendar:)`
/// decided. Which face that is — the name, the figures, or a sentence — is
/// not decided here, so no widget size can disagree with another about it.
/// The two Lock Screen families draw it as `AccessoryFaceView`, without the
/// Home Screen tile (`widgetBackground()`); the circle draws the system's
/// `AccessoryWidgetBackground` behind it. Every other family draws the system
/// face.
struct MonthEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MonthEntry

    var body: some View {
        let face = WidgetSnapshot.face(
            of: entry.snapshot, isPlaceholder: entry.isPlaceholder, now: entry.date, calendar: .current)
        if #available(iOSApplicationExtension 16.0, *) {
            if family == .accessoryRectangular || family == .accessoryCircular {
                AccessoryFaceView(family: family, face: face)
                    .accessoryBackground()
            } else {
                systemFace(face)
            }
        } else {
            systemFace(face)
        }
    }

    private func systemFace(_ face: WidgetSnapshot.Face) -> some View {
        systemContent(face)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetBackground()
    }

    @ViewBuilder
    private func systemContent(_ face: WidgetSnapshot.Face) -> some View {
        switch face {
        case .name:
            AppNameView()
                .font(.headline)
        case .figures(let labels, let figures, let redacted):
            FiguresView(family: family, labels: labels, figures: figures)
                .redacted(reason: redacted ? .placeholder : [])
        case .sentence(_, let title, let text):
            SentenceView(title: title, sentence: text)
        }
    }
}

/// The app's name in the device's language, drawn wherever there is no
/// snapshot to read. One view, so every family names the app the same way,
/// and the same way the gallery does.
private struct AppNameView: View {
    var body: some View {
        Text(HomeAccountMonthWidget.appName)
    }
}

/// The Lock Screen faces: the month's net balance alone, or the sentence that
/// says why there is none. The rectangle has the room for words under its
/// title; the circle has room for a figure with its label, or for a glyph
/// that carries the sentence as its accessibility label.
@available(iOSApplicationExtension 16.0, *)
private struct AccessoryFaceView: View {
    let family: WidgetFamily
    let face: WidgetSnapshot.Face

    var body: some View {
        if family == .accessoryCircular {
            circular
        } else {
            rectangular
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var rectangular: some View {
        switch face {
        case .name:
            AppNameView()
                .font(.headline)
                .widgetAccentable()
        case .figures(let labels, let figures, let redacted):
            VStack(alignment: .leading, spacing: 0) {
                Text(labels.title)
                    .font(.headline)
                    .widgetAccentable()
                    .lineLimit(1)
                Text(labels.net)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(figures.net)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .privacySensitive()
            }
            .redacted(reason: redacted ? .placeholder : [])
        case .sentence(_, let title, let text):
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(.headline)
                    .widgetAccentable()
                    .lineLimit(1)
                Text(text)
                    .font(.caption)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
            }
        }
    }

    @ViewBuilder
    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch face {
            case .name:
                AppNameView()
                    .font(.caption2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.5)
                    .padding(6)
            case .figures(let labels, let figures, let redacted):
                VStack(spacing: 0) {
                    Text(labels.net)
                        .font(.caption2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text(figures.net)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.3)
                        .privacySensitive()
                }
                .padding(6)
                .redacted(reason: redacted ? .placeholder : [])
            case .sentence(let sentence, _, let text):
                Image(systemName: sentence.symbolName)
                    .font(.title2)
                    .accessibilityLabel(text)
            }
        }
    }
}

private extension WidgetSnapshot.Sentence {
    /// What a circle too small for the sentence draws in its place.
    var symbolName: String {
        switch self {
        case .locked: return "lock.fill"
        case .signedOut: return "person.crop.circle.badge.xmark"
        case .stale: return "arrow.clockwise"
        }
    }
}

private struct FiguresView: View {
    let family: WidgetFamily
    let labels: WidgetSnapshot.Labels
    let figures: WidgetSnapshot.Figures

    /// The medium widget draws a section only for a card the account shows on
    /// the dashboard, and the month alone when both are hidden.
    var body: some View {
        if family == .systemMedium, figures.shows(.budgets) || figures.shows(.upcoming) {
            HStack(alignment: .top, spacing: 12) {
                month
                VStack(alignment: .leading, spacing: 8) {
                    if figures.shows(.budgets) {
                        topBudget
                    }
                    if figures.shows(.upcoming) {
                        nextScheduled
                    }
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
                    .privacySensitive()
                Text(budget.detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .privacySensitive()
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
                        .privacySensitive()
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
                .privacySensitive()
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

    /// A Lock Screen widget sits on the system's own backdrop. iOS 17 still
    /// wants a container background declared, and gets a clear one so nothing
    /// is drawn under the face; iOS 16 asks for none.
    @ViewBuilder
    func accessoryBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) {
                Color.clear
            }
        } else {
            self
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
            nextScheduled: NextScheduled(name: "Scheduled", date: "1 Jan", amount: "00.00"),
            hidden: nil
        )
    )
}
