import Foundation

/// The home-screen widget's only input: one JSON file the app writes into the
/// App Group container and the widget reads on each timeline refresh.
///
/// The widget never formats a figure, a currency or a date. The web layer
/// composes every string — labels, amounts, the whole "Updated …" sentence —
/// in the account's language and base currency, with the same catalogs and
/// formatters the dashboard paints with. Formatting here would need a second
/// copy of the translations and the currency rules, and would drift from the
/// app the first time either changed. The one thing decided on this side is
/// whether the figures can still be vouched for (`display(now:calendar:)`).
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

    struct Figures: Codable, Equatable {
        let spent: String
        let net: String
        let topBudget: TopBudget?
        let nextScheduled: NextScheduled?
    }

    enum Display: Equatable {
        case figures(Figures)
        case locked
        case signedOut
        case stale
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
