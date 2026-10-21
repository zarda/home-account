import Foundation

/// The home-screen widget's only input: one JSON file the app writes into the
/// App Group container and the widget reads on each timeline refresh.
///
/// The widget never formats a figure, a currency or a date. The web layer
/// composes every string — labels, amounts, the whole "Updated …" sentence —
/// in the account's language and base currency, with the same catalogs and
/// formatters the dashboard paints with. Formatting here would need a second
/// copy of the translations and the currency rules, and would drift from the
/// app the first time either changed. What is decided on this side is
/// whether the figures can still be vouched for (`display(now:calendar:)`) and
/// which face every widget size draws from that answer
/// (`face(of:isPlaceholder:now:calendar:)`): one decision, so no size can read
/// the snapshot differently from another.
///
/// Pure Foundation: compiled into every target that touches the file, since
/// an extension target cannot be imported.
struct WidgetSnapshot: Codable, Equatable {
    static let appGroupId = "group.com.homeaccount.app"
    static let fileName = "widget-snapshot.json"
    static let supportedVersion = 1

    enum State: String, Codable, Equatable {
        case figures
        case locked
        case signedOut
    }

    struct Labels: Codable, Equatable {
        let title: String
        let spent: String
        let net: String
        let topBudget: String
        let nextScheduled: String
        let noBudgets: String
        let nothingScheduled: String
        let locked: String
        let signedOut: String
        let stale: String
        /// The whole sentence, date included.
        let updated: String
    }

    struct TopBudget: Codable, Equatable {
        let name: String
        let percent: Int
        let detail: String
    }

    struct NextScheduled: Codable, Equatable {
        let name: String
        let date: String
        let amount: String
    }

    /// A dashboard card the widget draws a section for (the web's
    /// `WIDGET_CARDS`). Any other id fails the whole decode: the web and the
    /// widget ship together, so an unknown one is a payload this build was not
    /// written for.
    enum Card: String, Codable, Equatable {
        case budgets
        case upcoming
    }

    struct Figures: Codable, Equatable {
        let spent: String
        let net: String
        /// Nil when there is no budget to rank, and when Budget Progress is hidden.
        let topBudget: TopBudget?
        /// Nil when nothing is scheduled, and when Upcoming Bills is hidden.
        let nextScheduled: NextScheduled?
        /// The cards the account hid on the dashboard, which tells a hidden
        /// card from one with nothing to show. Absent in a file an older build
        /// wrote, and that build hid nothing.
        let hidden: [Card]?

        /// Whether the medium widget draws `card`'s section.
        func shows(_ card: Card) -> Bool {
            !(hidden ?? []).contains(card)
        }
    }

    enum Display: Equatable {
        case figures(Figures)
        case locked
        case signedOut
        case stale
    }

    /// The words a face shows instead of figures, one per state that has
    /// none. A family too small for the words can draw a glyph for the case
    /// and keep the words as its accessibility label.
    enum Sentence: Equatable {
        case locked
        case signedOut
        case stale
    }

    /// What a widget draws, whatever its size. Every family reads this one
    /// answer and decides only how to lay it out.
    enum Face: Equatable {
        /// No snapshot to read: the app's name alone.
        case name
        /// The month's figures. `redacted` is the gallery's sample, drawn as
        /// shapes, never read.
        case figures(Labels, Figures, redacted: Bool)
        /// A sentence under the title: why there are no figures.
        case sentence(Sentence, title: String, text: String)
    }

    let version: Int
    let state: State
    /// Epoch milliseconds.
    let writtenAt: Double
    /// The local `YYYY-MM` the figures belong to.
    let monthKey: String
    let labels: Labels
    /// Required when `state` is `.figures`; ignored otherwise.
    let figures: Figures?

    static func decode(_ data: Data) -> WidgetSnapshot? {
        guard
            let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
            snapshot.version == supportedVersion,
            snapshot.state != .figures || snapshot.figures != nil,
            yearMonth(snapshot.monthKey) != nil
        else { return nil }
        return snapshot
    }

    static func load(from folder: URL) -> WidgetSnapshot? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(fileName)) else { return nil }
        return decode(data)
    }

    /// The one decision behind every widget size.
    ///
    /// No snapshot is the app's name, placeholder or not. A placeholder that
    /// carries figures is decided *before* the clock is read: the gallery's
    /// sample is dated long ago and must still draw as the sample, redacted,
    /// not as an out-of-date month. Anything else is a placed widget and
    /// follows `display(now:calendar:)`, with the sentence its state calls
    /// for taken from the labels the web composed.
    static func face(
        of snapshot: WidgetSnapshot?, isPlaceholder: Bool, now: Date, calendar: Calendar
    ) -> Face {
        guard let snapshot else { return .name }
        if isPlaceholder, let figures = snapshot.figures {
            return .figures(snapshot.labels, figures, redacted: true)
        }
        let labels = snapshot.labels
        switch snapshot.display(now: now, calendar: calendar) {
        case .figures(let figures):
            return .figures(labels, figures, redacted: false)
        case .locked:
            return .sentence(.locked, title: labels.title, text: labels.locked)
        case .signedOut:
            return .sentence(.signedOut, title: labels.title, text: labels.signedOut)
        case .stale:
            return .sentence(.stale, title: labels.title, text: labels.stale)
        }
    }

    /// The provider's own timeline: an entry dated now and one dated at the
    /// next month boundary, both meant to carry the same loaded snapshot. A
    /// reload the app requests always lands promptly, but iOS may run the
    /// widget's *own* scheduled reload late, so without an entry dated
    /// exactly at the turn the display would keep evaluating last month's
    /// figures as "this month" until that late reload finally happens — the
    /// boundary entry's `display(now:calendar:)` call turns stale on its own,
    /// no reload required. Gregorian and the caller's time zone, the same
    /// rule `display(now:calendar:)` uses to read `monthKey`.
    static func timelineDates(now: Date, timeZone: TimeZone) -> (entries: [Date], reloadAt: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let boundary = calendar.dateInterval(of: .month, for: now)?.end ?? now.addingTimeInterval(3600)
        return (entries: [now, boundary], reloadAt: boundary)
    }

    /// Validated before the disk is touched, so a payload the widget could not
    /// read never replaces one it can. Atomic, because the widget's process may
    /// read at any moment and must see the old snapshot or the new one, never a
    /// torn file.
    @discardableResult
    static func write(_ data: Data, to folder: URL) throws -> WidgetSnapshot {
        guard let snapshot = decode(data) else { throw WidgetSnapshotError.invalid }
        try data.write(to: folder.appendingPathComponent(fileName), options: .atomic)
        return snapshot
    }

    /// Last month's figures under a "this month" title would be a wrong answer
    /// the widget cannot detect any other way — it has no data source of its
    /// own — so once the calendar's month has moved past `monthKey` they give
    /// way to the stale sentence. A key ahead of the clock is shown: those
    /// figures are not out of date, the clock is. Locked and signed-out
    /// snapshots carry no figures worth dating.
    ///
    /// `monthKey` is always a Gregorian `YYYY-MM` — the web composes it from a
    /// JS `Date` — so `now`'s year and month are read from a Gregorian
    /// calendar built here, not from `calendar` itself; only `calendar`'s
    /// time zone is taken from the caller. A device set to the Republic of
    /// China or Buddhist calendar must still compare like with like.
    func display(now: Date, calendar: Calendar) -> Display {
        switch state {
        case .locked:
            return .locked
        case .signedOut:
            return .signedOut
        case .figures:
            var gregorian = Calendar(identifier: .gregorian)
            gregorian.timeZone = calendar.timeZone
            let current = gregorian.dateComponents([.year, .month], from: now)
            guard
                let figures,
                let written = Self.yearMonth(monthKey),
                let year = current.year,
                let month = current.month
            else { return .stale }
            return written < (year, month) ? .stale : .figures(figures)
        }
    }

    private static func yearMonth(_ key: String) -> (Int, Int)? {
        let parts = key.split(separator: "-", omittingEmptySubsequences: false)
        guard
            parts.count == 2, parts[0].count == 4, parts[1].count == 2,
            parts.allSatisfy({ $0.allSatisfy { ("0"..."9").contains($0) } }),
            let year = Int(parts[0]), let month = Int(parts[1]),
            (1...12).contains(month)
        else { return nil }
        return (year, month)
    }
}

enum WidgetSnapshotError: Error, Equatable {
    /// The payload does not decode as a supported snapshot.
    case invalid
}
