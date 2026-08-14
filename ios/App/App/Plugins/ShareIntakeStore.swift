import Foundation

/// The App Group share store, separated from its Capacitor shell so the
/// XCTest target can drive it against a plain temp directory. The plugin
/// resolves the App Group folder and forwards here; everything below is
/// pure file work.
///
/// The extension writes `<uuid>.payload` + `<uuid>.json` sidecars carrying
/// `{ name, mimeType, payload, receivedAt }` (see ShareViewController.swift
/// — the two targets share no code, so the App Group id, folder name and
/// sidecar shape are duplicated there; change them together). Consumption
/// is two-step: the web layer fetches everything, decides what a session
/// may claim, and names what to delete — so a share nobody may claim yet is
/// not destroyed on the way past.
enum ShareIntakeStore {

    static func pendingCount(in folder: URL) -> Int {
        sidecarURLs(in: folder).count
    }

    /// Every readable waiting file, WITHOUT deleting anything delivered.
    static func collectPendingShares(in folder: URL) -> [[String: String]] {
        var files: [[String: String]] = []

        for sidecarURL in sidecarURLs(in: folder) {
            let id = sidecarURL.deletingPathExtension().lastPathComponent
            guard
                let sidecarData = try? Data(contentsOf: sidecarURL),
                let sidecar = (try? JSONSerialization.jsonObject(with: sidecarData)) as? [String: String],
                let payloadName = sidecar["payload"],
                let payload = try? Data(contentsOf: folder.appendingPathComponent(payloadName))
            else {
                // Wreckage: a sidecar that cannot be parsed, or whose payload
                // is gone, can never be delivered. Deleting it is sweeping,
                // not destroying a share — an unparseable sidecar used to be
                // skipped here and re-walked forever.
                removeEntry(id: id, in: folder)
                continue
            }

            files.append([
                "id": id,
                "name": sidecar["name"] ?? payloadName,
                "mimeType": sidecar["mimeType"] ?? "application/octet-stream",
                "receivedAt": sidecar["receivedAt"] ?? "",
                "base64": payload.base64EncodedString()
            ])
            // Deliberately not deleted: the web layer decides what it kept
            // and names it to completeEntries. If that call never lands, the
            // same files are offered again next activation — a duplicate
            // offer, which the review step absorbs, rather than a share
            // destroyed before anyone saw it.
        }

        sweepOrphanedPayloads(in: folder)
        return files
    }

    static func completeEntries(ids: [String], in folder: URL) {
        // Ids are UUID basenames minted by the extension; anything carrying
        // a path separator is not one of ours.
        for id in ids where !id.contains("/") && !id.contains("..") {
            removeEntry(id: id, in: folder)
        }
    }

    static func clearEntries(in folder: URL) {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: nil) else { return }
        for entry in entries {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    static func sidecarURLs(in folder: URL) -> [URL] {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: nil) else { return [] }
        return entries.filter { $0.pathExtension == "json" }
    }

    static func removeEntry(id: String, in folder: URL) {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id).payload"))
        try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id).json"))
    }

    /// A `.payload` with no `.json` sibling is invisible to every consumer
    /// and used to accumulate forever. The hour of grace covers the
    /// extension's write order (payload first, sidecar second), so a share
    /// being written right now is not swept mid-write.
    static func sweepOrphanedPayloads(in folder: URL) {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: [.creationDateKey]) else { return }
        let sidecarIds = Set(entries.filter { $0.pathExtension == "json" }
            .map { $0.deletingPathExtension().lastPathComponent })
        for entry in entries where entry.pathExtension == "payload" {
            let id = entry.deletingPathExtension().lastPathComponent
            if sidecarIds.contains(id) { continue }
            let created = (try? entry.resourceValues(forKeys: [.creationDateKey]))?.creationDate
            if let created, Date().timeIntervalSince(created) < 60 * 60 { continue }
            try? FileManager.default.removeItem(at: entry)
        }
    }
}
