import XCTest
import UniformTypeIdentifiers

// The Swift half of the share pipeline, driven against temp directories.
// These are the seams every web-side gate is blind to: the extension's
// sidecar writer (ShareViewController.swift is compiled into this bundle —
// an extension target cannot be imported), the App Group store behind
// ShareIntakePlugin, and the data-URL strip Vision OCR decodes through.

final class ShareStashWriterTests: XCTestCase {
    private var container: URL!
    private var inbox: URL!

    override func setUpWithError() throws {
        container = FileManager.default.temporaryDirectory
            .appendingPathComponent("stash-\(UUID().uuidString)", isDirectory: true)
        inbox = FileManager.default.temporaryDirectory
            .appendingPathComponent("inbox-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: container)
        try? FileManager.default.removeItem(at: inbox)
    }

    /// The file loadFileRepresentation would hand over: real bytes on disk.
    private func deliver(_ name: String, bytes: [UInt8] = [0xFF, 0xD8, 0xFF]) throws -> URL {
        let url = inbox.appendingPathComponent(name)
        try Data(bytes).write(to: url)
        return url
    }

    private func sidecars() throws -> [[String: String]] {
        try FileManager.default.contentsOfDirectory(at: container, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                (try? JSONSerialization.jsonObject(with: Data(contentsOf: url))) as? [String: String]
            }
    }

    private func containerEntryCount() throws -> Int {
        try FileManager.default.contentsOfDirectory(at: container, includingPropertiesForKeys: nil).count
    }

    func testStampsAJpegWithItsConcreteType() throws {
        // The matched accepted type is the abstract .image, which declares no
        // MIME — the delivered file's own type is what must win.
        let delivered = try deliver("IMG_0042.jpg")

        XCTAssertTrue(ShareViewController.stash(fileAt: delivered, as: .image, into: container))

        let sidecar = try XCTUnwrap(sidecars().first)
        XCTAssertEqual(sidecar["mimeType"], "image/jpeg")
        XCTAssertEqual(sidecar["name"], "IMG_0042.jpg")
    }

    func testStampsAPngWithItsConcreteType() throws {
        let delivered = try deliver("receipt.png", bytes: [0x89, 0x50, 0x4E, 0x47])

        XCTAssertTrue(ShareViewController.stash(fileAt: delivered, as: .image, into: container))

        XCTAssertEqual(try XCTUnwrap(sidecars().first)["mimeType"], "image/png")
    }

    func testStampsAPdfWithItsConcreteType() throws {
        let delivered = try deliver("statement.pdf", bytes: [0x25, 0x50, 0x44, 0x46])

        XCTAssertTrue(ShareViewController.stash(fileAt: delivered, as: .pdf, into: container))

        XCTAssertEqual(try XCTUnwrap(sidecars().first)["mimeType"], "application/pdf")
    }

    func testFallsBackToOctetStreamWhenNothingKnowsTheType() throws {
        // An extension nobody registered and an abstract matched type with no
        // MIME of its own: the last rung of the ladder.
        let delivered = try deliver("payload.weirdext")

        XCTAssertTrue(ShareViewController.stash(fileAt: delivered, as: .image, into: container))

        XCTAssertEqual(try XCTUnwrap(sidecars().first)["mimeType"], "application/octet-stream")
    }

    func testSidecarCarriesAFreshEpochTimestamp() throws {
        let delivered = try deliver("IMG_0001.jpg")
        let before = Date().timeIntervalSince1970 * 1000

        XCTAssertTrue(ShareViewController.stash(fileAt: delivered, as: .image, into: container))

        let stamp = try XCTUnwrap(Double(try XCTUnwrap(sidecars().first)["receivedAt"] ?? ""))
        let after = Date().timeIntervalSince1970 * 1000
        XCTAssertGreaterThanOrEqual(stamp, before - 1000)
        XCTAssertLessThanOrEqual(stamp, after + 1000)
    }

    func testPayloadBytesSurviveTheCopy() throws {
        let bytes: [UInt8] = [0xDE, 0xAD, 0xBE, 0xEF]
        let delivered = try deliver("IMG_0002.jpg", bytes: bytes)

        XCTAssertTrue(ShareViewController.stash(fileAt: delivered, as: .image, into: container))

        let payloadName = try XCTUnwrap(sidecars().first?["payload"])
        let payload = try Data(contentsOf: container.appendingPathComponent(payloadName))
        XCTAssertEqual([UInt8](payload), bytes)
    }

    func testRollsBackBothHalvesWhenTheCopyFails() throws {
        // The source URL dies with loadFileRepresentation's handler; a copy
        // that finds nothing must leave no half-written entry behind.
        let missing = inbox.appendingPathComponent("gone.jpg")

        XCTAssertFalse(ShareViewController.stash(fileAt: missing, as: .image, into: container))

        XCTAssertEqual(try containerEntryCount(), 0)
    }

    func testJpegLeadsTheAcceptedTypes() {
        // .jpeg first is what makes the provider transcode a HEIC; .image
        // right behind it catches images with no JPEG representation.
        XCTAssertEqual(ShareViewController.acceptedTypes.first, .jpeg)
        XCTAssertEqual(ShareViewController.acceptedTypes.dropFirst().first, .image)
    }
}

final class ShareIntakeStoreTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("intake-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    @discardableResult
    private func writeEntry(
        id: String = UUID().uuidString,
        mimeType: String = "image/jpeg",
        receivedAt: String = "1700000000000",
        payload: Data = Data([1, 2, 3])
    ) throws -> String {
        try payload.write(to: folder.appendingPathComponent("\(id).payload"))
        let sidecar = [
            "name": "r.jpg",
            "mimeType": mimeType,
            "payload": "\(id).payload",
            "receivedAt": receivedAt
        ]
        try JSONSerialization.data(withJSONObject: sidecar)
            .write(to: folder.appendingPathComponent("\(id).json"))
        return id
    }

    private func entryNames() throws -> Set<String> {
        Set(try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .map { $0.lastPathComponent })
    }

    func testCollectReturnsTheEntryWithoutDeletingIt() throws {
        let id = try writeEntry()

        let files = ShareIntakeStore.collectPendingShares(in: folder)

        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files.first?["id"], id)
        // Fetch → decide → complete: nothing is destroyed on the way past.
        XCTAssertTrue(try entryNames().contains("\(id).payload"))
        XCTAssertTrue(try entryNames().contains("\(id).json"))
    }

    func testCollectCarriesTheSidecarFieldsAndPayload() throws {
        try writeEntry(mimeType: "image/png", receivedAt: "1234", payload: Data([9, 8, 7]))

        let file = try XCTUnwrap(ShareIntakeStore.collectPendingShares(in: folder).first)

        XCTAssertEqual(file["name"], "r.jpg")
        XCTAssertEqual(file["mimeType"], "image/png")
        XCTAssertEqual(file["receivedAt"], "1234")
        XCTAssertEqual(file["base64"], Data([9, 8, 7]).base64EncodedString())
    }

    func testUnparseableSidecarIsSweptNotReturned() throws {
        let id = UUID().uuidString
        try Data([1]).write(to: folder.appendingPathComponent("\(id).payload"))
        try Data("not json".utf8).write(to: folder.appendingPathComponent("\(id).json"))

        let files = ShareIntakeStore.collectPendingShares(in: folder)

        XCTAssertTrue(files.isEmpty)
        // Wreckage used to be skipped and re-walked forever; now both halves go.
        XCTAssertTrue(try entryNames().isEmpty)
    }

    func testSidecarWithMissingPayloadIsSwept() throws {
        let id = UUID().uuidString
        let sidecar = ["name": "r.jpg", "mimeType": "image/jpeg", "payload": "\(id).payload"]
        try JSONSerialization.data(withJSONObject: sidecar)
            .write(to: folder.appendingPathComponent("\(id).json"))

        let files = ShareIntakeStore.collectPendingShares(in: folder)

        XCTAssertTrue(files.isEmpty)
        XCTAssertTrue(try entryNames().isEmpty)
    }

    func testFreshOrphanPayloadSurvivesTheSweep() throws {
        // The extension writes payload first, sidecar second — a lone fresh
        // payload may be a share being written right now.
        try Data([1]).write(to: folder.appendingPathComponent("half-written.payload"))

        _ = ShareIntakeStore.collectPendingShares(in: folder)

        XCTAssertTrue(try entryNames().contains("half-written.payload"))
    }

    func testStaleOrphanPayloadIsSwept() throws {
        let orphan = folder.appendingPathComponent("stranded.payload")
        try Data([1]).write(to: orphan)
        try FileManager.default.setAttributes(
            [.creationDate: Date(timeIntervalSinceNow: -2 * 60 * 60)],
            ofItemAtPath: orphan.path
        )

        _ = ShareIntakeStore.collectPendingShares(in: folder)

        XCTAssertFalse(try entryNames().contains("stranded.payload"))
    }

    func testCompleteDeletesExactlyTheNamedEntries() throws {
        let consumed = try writeEntry()
        let waiting = try writeEntry()

        ShareIntakeStore.completeEntries(ids: [consumed], in: folder)

        XCTAssertFalse(try entryNames().contains("\(consumed).json"))
        XCTAssertFalse(try entryNames().contains("\(consumed).payload"))
        XCTAssertTrue(try entryNames().contains("\(waiting).json"))
        XCTAssertTrue(try entryNames().contains("\(waiting).payload"))
    }

    func testCompleteRefusesPathTraversalIds() throws {
        // A hostile id must not reach outside the folder. The victim lives in
        // the parent directory, one "../" away.
        let victim = folder.deletingLastPathComponent()
            .appendingPathComponent("victim-\(UUID().uuidString).payload")
        try Data([1]).write(to: victim)
        defer { try? FileManager.default.removeItem(at: victim) }
        let victimId = victim.deletingPathExtension().lastPathComponent

        ShareIntakeStore.completeEntries(ids: ["../\(victimId)", "a/b"], in: folder)

        XCTAssertTrue(FileManager.default.fileExists(atPath: victim.path))
    }

    func testClearEmptiesTheFolder() throws {
        try writeEntry()
        try writeEntry()
        try Data([1]).write(to: folder.appendingPathComponent("stranded.payload"))

        ShareIntakeStore.clearEntries(in: folder)

        XCTAssertTrue(try entryNames().isEmpty)
    }

    func testPendingCountCountsSidecarsOnly() throws {
        try writeEntry()
        try Data([1]).write(to: folder.appendingPathComponent("orphan.payload"))

        XCTAssertEqual(ShareIntakeStore.pendingCount(in: folder), 1)
    }
}

final class DataURLTests: XCTestCase {
    func testStripsAnImagePrefix() {
        XCTAssertEqual(DataURL.stripBase64Prefix("data:image/png;base64,abc"), "abc")
    }

    func testStripsAGenericPrefix() {
        // The shape a mislabelled shared photo produces — the strip must not
        // anchor on data:image/.
        XCTAssertEqual(
            DataURL.stripBase64Prefix("data:application/octet-stream;base64,abc"),
            "abc"
        )
    }

    func testLeavesBareBase64Alone() {
        XCTAssertEqual(DataURL.stripBase64Prefix("rawbase64"), "rawbase64")
    }
}
