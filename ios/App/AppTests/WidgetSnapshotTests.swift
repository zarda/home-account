import XCTest

// The contract between the web layer that composes the snapshot and the
// widget that paints it. Neither end can run here — the writer is a
// Capacitor plugin and the reader a WidgetKit extension — so the decoder,
// the validated write and the month rule are the seam these pin down.

final class WidgetSnapshotTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("widget-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    private static let labels = """
        "labels": {
          "title": "This month", "spent": "Spent", "net": "Net",
          "topBudget": "Top budget", "nextScheduled": "Next scheduled",
          "noBudgets": "No budgets", "nothingScheduled": "Nothing scheduled",
          "locked": "Unlock the app to see your figures",
          "signedOut": "Sign in to see your figures",
          "stale": "Open the app to refresh this month",
          "updated": "Updated 14 Sep 2026"
        }
        """

    private static let figures = """
        {
          "spent": "NT$12,340", "net": "-NT$2,100",
          "topBudget": { "name": "Groceries", "percent": 87, "detail": "NT$8,700 of NT$10,000" },
          "nextScheduled": { "name": "Rent", "date": "1 Oct 2026", "amount": "NT$25,000" }
        }
        """

    /// A payload as the web layer writes it; `figures: nil` omits the key.
    private func payload(
        version: Int = 1,
        state: String = "figures",
        monthKey: String = "2026-09",
        figures: String? = WidgetSnapshotTests.figures
    ) -> Data {
        var fields = [
            "\"version\": \(version)",
            "\"state\": \"\(state)\"",
            "\"writtenAt\": 1789372800000",
            "\"monthKey\": \"\(monthKey)\"",
            WidgetSnapshotTests.labels
        ]
        if let figures { fields.append("\"figures\": \(figures)") }
        return Data("{ \(fields.joined(separator: ", ")) }".utf8)
    }

    private var taipei: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        return calendar
    }

    /// Same zone, non-Gregorian numbering: `display` must compare against
    /// `monthKey`'s Gregorian year and month regardless of the caller's
    /// calendar system.
    private var taipeiROC: Calendar {
        var calendar = Calendar(identifier: .republicOfChina)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        return calendar
    }

    private var taipeiBuddhist: Calendar {
        var calendar = Calendar(identifier: .buddhist)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        return calendar
    }

    private func instant(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    // MARK: Decoding

    func testDecodesAVersionOneFiguresPayload() throws {
        let snapshot = try XCTUnwrap(WidgetSnapshot.decode(payload()))

        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.state, .figures)
        XCTAssertEqual(snapshot.writtenAt, 1789372800000)
        XCTAssertEqual(snapshot.monthKey, "2026-09")
        XCTAssertEqual(snapshot.labels.updated, "Updated 14 Sep 2026")
        let figures = try XCTUnwrap(snapshot.figures)
        XCTAssertEqual(figures.spent, "NT$12,340")
        XCTAssertEqual(figures.net, "-NT$2,100")
        XCTAssertEqual(figures.topBudget, .init(name: "Groceries", percent: 87, detail: "NT$8,700 of NT$10,000"))
        XCTAssertEqual(figures.nextScheduled, .init(name: "Rent", date: "1 Oct 2026", amount: "NT$25,000"))

        // No budgets and nothing scheduled are still figures, not a failure.
        let bare = try XCTUnwrap(WidgetSnapshot.decode(payload(
            figures: #"{ "spent": "NT$0", "net": "NT$0", "topBudget": null, "nextScheduled": null }"#)))
        XCTAssertNil(bare.figures?.topBudget)
        XCTAssertNil(bare.figures?.nextScheduled)
    }

    func testDecodesLockedWithNoFigures() throws {
        let snapshot = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "locked", figures: nil)))

        XCTAssertEqual(snapshot.state, .locked)
        XCTAssertNil(snapshot.figures)
        XCTAssertEqual(snapshot.labels.locked, "Unlock the app to see your figures")
    }

    func testDecodesSignedOutWithNoFigures() throws {
        let snapshot = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "signedOut", figures: "null")))

        XCTAssertEqual(snapshot.state, .signedOut)
        XCTAssertNil(snapshot.figures)
    }

    func testAVersionTwoPayloadIsRejected() {
        XCTAssertNil(WidgetSnapshot.decode(payload(version: 2)))
    }

    func testAFiguresStateWithoutFiguresIsRejected() {
        XCTAssertNil(WidgetSnapshot.decode(payload(figures: nil)))
        XCTAssertNil(WidgetSnapshot.decode(payload(figures: "null")))
    }

    func testMalformedDataIsRejected() {
        XCTAssertNil(WidgetSnapshot.decode(Data()))
        XCTAssertNil(WidgetSnapshot.decode(Data("not json".utf8)))
        XCTAssertNil(WidgetSnapshot.decode(payload().prefix(60)))
        XCTAssertNil(WidgetSnapshot.decode(payload(state: "hidden")))
        // Not exactly four digits, a hyphen, two digits, month 01-12.
        XCTAssertNil(WidgetSnapshot.decode(payload(monthKey: "2026-9")))
        XCTAssertNil(WidgetSnapshot.decode(payload(monthKey: "2026-13")))
        XCTAssertNil(WidgetSnapshot.decode(payload(monthKey: "26-09")))
    }

    // MARK: Hidden cards

    /// The figures the web writes for an account that hid `hidden` (a JSON
    /// value, spliced as given): a hidden card's field is null.
    private static func hiddenFigures(_ hidden: String) -> String {
        """
        {
          "spent": "NT$12,340", "net": "-NT$2,100",
          "topBudget": null, "nextScheduled": null,
          "hidden": \(hidden)
        }
        """
    }

    func testDecodesTheHiddenCards() throws {
        let budgets = try XCTUnwrap(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#"["budgets"]"#))))
        XCTAssertEqual(budgets.figures?.hidden, [.budgets])

        let none = try XCTUnwrap(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures("[]"))))
        XCTAssertEqual(none.figures?.hidden, [])
    }

    /// Pin: a file an older build wrote carries no `hidden`, and that build
    /// hid nothing.
    func testAFileWithoutHiddenShowsEveryCard() throws {
        let figures = try XCTUnwrap(WidgetSnapshot.decode(payload())?.figures)

        XCTAssertNil(figures.hidden)
        XCTAssertTrue(figures.shows(.budgets))
        XCTAssertTrue(figures.shows(.upcoming))
    }

    /// The web and the widget ship together, so an id this build does not
    /// know belongs to a payload it was not written for.
    func testAnUnknownHiddenCardIsRejected() {
        XCTAssertNil(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#"["recent"]"#))))
        XCTAssertNil(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#"["budgets", "chart"]"#))))
        XCTAssertNil(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#""budgets""#))))

        // The positive proof: the same payload with known ids decodes.
        XCTAssertNotNil(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#"["budgets", "upcoming"]"#))))
    }

    func testHiddenCardsRoundTripThroughAWriteAndALoad() throws {
        let written = try WidgetSnapshot.write(payload(figures: Self.hiddenFigures(#"["upcoming"]"#)), to: folder)
        let loaded = try XCTUnwrap(WidgetSnapshot.load(from: folder))

        XCTAssertEqual(loaded, written)
        XCTAssertEqual(loaded.figures?.hidden, [.upcoming])
    }

    func testAHiddenCardIsNotShown() throws {
        let both = try XCTUnwrap(
            WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#"["budgets", "upcoming"]"#)))?.figures)
        XCTAssertFalse(both.shows(.budgets))
        XCTAssertFalse(both.shows(.upcoming))

        let upcoming = try XCTUnwrap(WidgetSnapshot.decode(payload(figures: Self.hiddenFigures(#"["upcoming"]"#)))?.figures)
        XCTAssertTrue(upcoming.shows(.budgets))
        XCTAssertFalse(upcoming.shows(.upcoming))
    }

    // MARK: Writing

    func testWriteRefusesUndecodableDataAndLeavesThePreviousFileIntact() throws {
        let file = folder.appendingPathComponent(WidgetSnapshot.fileName)

        XCTAssertThrowsError(try WidgetSnapshot.write(Data("{".utf8), to: folder)) { error in
            XCTAssertEqual(error as? WidgetSnapshotError, .invalid)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))

        let previous = payload()
        try WidgetSnapshot.write(previous, to: folder)

        XCTAssertThrowsError(try WidgetSnapshot.write(payload(version: 2), to: folder)) { error in
            XCTAssertEqual(error as? WidgetSnapshotError, .invalid)
        }
        XCTAssertThrowsError(try WidgetSnapshot.write(payload(figures: nil), to: folder)) { error in
            XCTAssertEqual(error as? WidgetSnapshotError, .invalid)
        }
        XCTAssertThrowsError(try WidgetSnapshot.write(payload(monthKey: "2026-13"), to: folder)) { error in
            XCTAssertEqual(error as? WidgetSnapshotError, .invalid)
        }
        XCTAssertEqual(try Data(contentsOf: file), previous)
    }

    func testWriteThenLoadRoundTrips() throws {
        XCTAssertNil(WidgetSnapshot.load(from: folder))

        let figures = try WidgetSnapshot.write(payload(), to: folder)
        XCTAssertEqual(WidgetSnapshot.load(from: folder), figures)

        let locked = try WidgetSnapshot.write(payload(state: "locked", figures: nil), to: folder)
        XCTAssertNotEqual(locked, figures)
        XCTAssertEqual(WidgetSnapshot.load(from: folder), locked)
        // The replace leaves one file behind, not a temp sibling beside it.
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), [WidgetSnapshot.fileName])
    }

    // MARK: Display state

    func testDisplayIsStaleInTheMonthAfterMonthKey() throws {
        let august = try XCTUnwrap(WidgetSnapshot.decode(payload(monthKey: "2026-08")))

        // 16:30 UTC on 31 August is already 00:30 on 1 September in Taipei:
        // the month is the calendar's, not UTC's.
        XCTAssertEqual(august.display(now: instant("2026-08-31T16:30:00Z"), calendar: taipei), .stale)
        XCTAssertEqual(august.display(now: instant("2026-10-15T04:00:00Z"), calendar: taipei), .stale)

        // Same zone, a Republic of China or Buddhist calendar: `monthKey`
        // is always Gregorian, so the answer must not change.
        XCTAssertEqual(august.display(now: instant("2026-08-31T16:30:00Z"), calendar: taipeiROC), .stale)
        XCTAssertEqual(august.display(now: instant("2026-08-31T16:30:00Z"), calendar: taipeiBuddhist), .stale)

        let december = try XCTUnwrap(WidgetSnapshot.decode(payload(monthKey: "2026-12")))
        XCTAssertEqual(december.display(now: instant("2027-01-01T00:00:00Z"), calendar: taipei), .stale)
    }

    func testDisplayShowsFiguresWithinTheMonthAndLockedWhateverTheMonth() throws {
        let august = try XCTUnwrap(WidgetSnapshot.decode(payload(monthKey: "2026-08")))
        let figures = try XCTUnwrap(august.figures)

        // 15:30 UTC on 31 August is still 23:30 on the 31st in Taipei.
        XCTAssertEqual(august.display(now: instant("2026-08-31T15:30:00Z"), calendar: taipei), .figures(figures))
        XCTAssertEqual(august.display(now: instant("2026-07-31T16:30:00Z"), calendar: taipei), .figures(figures))

        // Same instant, a Republic of China or Buddhist calendar in the
        // same zone: still within the month.
        XCTAssertEqual(august.display(now: instant("2026-08-31T15:30:00Z"), calendar: taipeiROC), .figures(figures))
        XCTAssertEqual(august.display(now: instant("2026-08-31T15:30:00Z"), calendar: taipeiBuddhist), .figures(figures))
        // A month key ahead of the device's clock is not stale.
        XCTAssertEqual(august.display(now: instant("2026-07-31T15:30:00Z"), calendar: taipei), .figures(figures))

        // Figures a locked snapshot happens to carry are never shown.
        let locked = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "locked", monthKey: "2026-08")))
        XCTAssertEqual(locked.display(now: instant("2026-08-15T04:00:00Z"), calendar: taipei), .locked)
        XCTAssertEqual(locked.display(now: instant("2026-10-15T04:00:00Z"), calendar: taipei), .locked)

        let signedOut = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "signedOut", monthKey: "2026-08", figures: nil)))
        XCTAssertEqual(signedOut.display(now: instant("2026-10-15T04:00:00Z"), calendar: taipei), .signedOut)
    }

    // MARK: Face

    /// 04:00 UTC on 14 September is noon in Taipei: inside the fixtures'
    /// `2026-09`.
    private var september: Date { instant("2026-09-14T04:00:00Z") }

    private func face(
        of snapshot: WidgetSnapshot?, isPlaceholder: Bool = false, now: Date? = nil
    ) -> WidgetSnapshot.Face {
        WidgetSnapshot.face(of: snapshot, isPlaceholder: isPlaceholder, now: now ?? september, calendar: taipei)
    }

    func testNoSnapshotIsTheNameWhateverThePlaceholderFlag() {
        XCTAssertEqual(face(of: nil), .name)
        XCTAssertEqual(face(of: nil, isPlaceholder: true), .name)
    }

    /// The gallery's sample is a snapshot, so the flag alone never means the
    /// name: a placeholder that has a sample draws it.
    func testAPlaceholderWithASampleIsNotTheName() throws {
        let sample = try XCTUnwrap(WidgetSnapshot.decode(payload()))

        let drawn = face(of: sample, isPlaceholder: true)

        XCTAssertNotEqual(drawn, .name)
        // The positive proof: the sample's own labels and figures.
        XCTAssertEqual(drawn, .figures(sample.labels, try XCTUnwrap(sample.figures), redacted: true))
    }

    /// `placeholderSample` is dated 2000-01, long past every clock the
    /// gallery runs on, and still draws redacted figures: the placeholder
    /// is decided before the month is read. The same snapshot placed is
    /// out of date, which proves the flag and not the month made the call.
    func testThePlaceholderOfAnOldMonthIsRedactedFigures() throws {
        let sample = try XCTUnwrap(WidgetSnapshot.decode(payload(monthKey: "2000-01")))
        let figures = try XCTUnwrap(sample.figures)

        XCTAssertEqual(face(of: sample, isPlaceholder: true), .figures(sample.labels, figures, redacted: true))
        XCTAssertEqual(
            face(of: sample, isPlaceholder: false),
            .sentence(.stale, title: "This month", text: "Open the app to refresh this month"))
    }

    /// Pin: a placeholder entry whose snapshot carries no figures has nothing
    /// to redact, so it reads like a placed one.
    func testAPlaceholderWithoutFiguresFollowsTheClockLikeAPlacedOne() throws {
        let locked = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "locked", figures: nil)))

        XCTAssertEqual(
            face(of: locked, isPlaceholder: true),
            .sentence(.locked, title: "This month", text: "Unlock the app to see your figures"))
    }

    func testAPlacedFaceFollowsDisplayAndCarriesItsSentence() throws {
        let figures = try XCTUnwrap(WidgetSnapshot.decode(payload()))
        XCTAssertEqual(
            face(of: figures),
            .figures(figures.labels, try XCTUnwrap(figures.figures), redacted: false))

        // The month after `monthKey`.
        let stale = try XCTUnwrap(WidgetSnapshot.decode(payload(monthKey: "2026-08")))
        XCTAssertEqual(
            face(of: stale),
            .sentence(.stale, title: "This month", text: "Open the app to refresh this month"))

        let locked = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "locked", figures: nil)))
        XCTAssertEqual(
            face(of: locked),
            .sentence(.locked, title: "This month", text: "Unlock the app to see your figures"))

        let signedOut = try XCTUnwrap(WidgetSnapshot.decode(payload(state: "signedOut", figures: nil)))
        XCTAssertEqual(
            face(of: signedOut),
            .sentence(.signedOut, title: "This month", text: "Sign in to see your figures"))
    }

    /// A placed face reads its month from the entry's own date, as the
    /// month-boundary entry of the timeline relies on.
    func testAPlacedFaceTurnsStaleAtTheMonthBoundaryEntry() throws {
        let snapshot = try XCTUnwrap(WidgetSnapshot.decode(payload()))
        let figures = try XCTUnwrap(snapshot.figures)

        // 15:59 UTC on 30 September is 23:59 in Taipei; 16:00 is 1 October.
        XCTAssertEqual(
            face(of: snapshot, now: instant("2026-09-30T15:59:00Z")),
            .figures(snapshot.labels, figures, redacted: false))
        XCTAssertEqual(
            face(of: snapshot, now: instant("2026-09-30T16:00:00Z")),
            .sentence(.stale, title: "This month", text: "Open the app to refresh this month"))
    }

    // MARK: Tap

    /// The app is opened by other URLs too (Google sign-in's redirect among
    /// them), so only this one may read as a tap on the widget.
    func testTheTapURLIsATap() {
        XCTAssertEqual(WidgetSnapshot.tapURL.absoluteString, "com.homeaccount.app://widget")
        XCTAssertTrue(WidgetSnapshot.isTap(WidgetSnapshot.tapURL))
    }

    /// A URL's scheme and host carry no case, so another spelling of the
    /// same URL is still the tap.
    func testAnUpperCaseSpellingOfTheTapURLIsATap() throws {
        XCTAssertTrue(WidgetSnapshot.isTap(try XCTUnwrap(URL(string: "COM.HomeAccount.APP://WIDGET"))))
    }

    func testGoogleSignInsRedirectIsNotATap() throws {
        let redirect = try XCTUnwrap(URL(string: "com.googleusercontent.apps.123-abc:/oauth2callback?code=x&state=y"))
        XCTAssertFalse(WidgetSnapshot.isTap(redirect))
    }

    func testAnotherHostUnderTheAppsSchemeIsNotATap() throws {
        XCTAssertFalse(WidgetSnapshot.isTap(try XCTUnwrap(URL(string: "com.homeaccount.app://dashboard"))))
    }

    func testTheWidgetHostUnderAnotherSchemeIsNotATap() throws {
        XCTAssertFalse(WidgetSnapshot.isTap(try XCTUnwrap(URL(string: "https://widget"))))
    }

    // MARK: Timeline dates

    /// The provider schedules two entries, not one: the second must land
    /// exactly on the month boundary in the caller's time zone, and that
    /// entry must itself read as stale so a late reload is never the only
    /// thing standing between the widget and last month's figures.
    func testTimelineDatesBracketsTheMonthBoundaryAndTheBoundaryEntryIsStale() throws {
        let now = instant("2026-08-31T15:30:00Z") // 23:30 in Taipei
        let boundary = instant("2026-08-31T16:00:00Z") // 2026-09-01 00:00 in Taipei
        let (dates, reloadAt) = WidgetSnapshot.timelineDates(now: now, timeZone: taipei.timeZone)
        XCTAssertEqual(dates, [now, boundary])
        XCTAssertEqual(reloadAt, boundary)

        // A December instant rolls the boundary into the next year.
        let december = instant("2026-12-25T10:00:00Z")
        let (_, decemberReloadAt) = WidgetSnapshot.timelineDates(now: december, timeZone: taipei.timeZone)
        XCTAssertEqual(decemberReloadAt, instant("2026-12-31T16:00:00Z")) // 2027-01-01 00:00 in Taipei

        // At the boundary itself, an August snapshot has already turned stale.
        let august = try XCTUnwrap(WidgetSnapshot.decode(payload(monthKey: "2026-08")))
        XCTAssertEqual(august.display(now: boundary, calendar: taipei), .stale)
    }
}
