import Foundation
import Capacitor
import UIKit

/// Surfaces files the Share Extension saved into the App Group container.
///
/// The extension writes `<uuid>.payload` + `<uuid>.json` sidecars carrying
/// `{ name, mimeType, payload, receivedAt }` (see ShareViewController.swift —
/// the two targets share no code, so the App Group id, folder name and
/// sidecar shape are duplicated there; change them together). This plugin
/// counts and hands them over, and pings the web layer on every app
/// activation, which is the first moment a share made in another app can be
/// noticed. Consumption is two-step: the web layer fetches everything,
/// decides what a session may claim, and names what to delete — so a share
/// nobody may claim yet is not destroyed on the way past.
@objc(ShareIntakePlugin)
public class ShareIntakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareIntakePlugin"
    public let jsName = "ShareIntake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPendingShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "completePendingShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPendingShares", returnType: CAPPluginReturnPromise)
    ]

    private static let appGroupId = "group.com.homeaccount.app"
    private static let folderName = "SharedImports"

    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func appDidBecomeActive() {
        notifyListeners("pendingSharesChanged", data: [:])
    }

    @objc func checkPendingShares(_ call: CAPPluginCall) {
        call.resolve(["count": Self.sidecarURLs().count])
    }

    @objc func consumePendingShares(_ call: CAPPluginCall) {
        var files: [[String: String]] = []
        guard let folder = Self.sharedFolderURL() else {
            call.resolve(["files": files])
            return
        }

        for sidecarURL in Self.sidecarURLs() {
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
                Self.removeEntry(id: id, in: folder)
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
            // and names it to completePendingShares. If that call never
            // lands, the same files are offered again next activation —
            // a duplicate offer, which the review step absorbs, rather than
            // a share destroyed before anyone saw it.
        }

        Self.sweepOrphanedPayloads(in: folder)
        call.resolve(["files": files])
    }

    @objc func completePendingShares(_ call: CAPPluginCall) {
        if let folder = Self.sharedFolderURL() {
            let ids = call.getArray("ids", String.self) ?? []
            // Ids are UUID basenames minted by the extension; anything
            // carrying a path separator is not one of ours.
            for id in ids where !id.contains("/") && !id.contains("..") {
                Self.removeEntry(id: id, in: folder)
            }
        }
        call.resolve()
    }

    @objc func clearPendingShares(_ call: CAPPluginCall) {
        if let folder = Self.sharedFolderURL(),
           let entries = try? FileManager.default.contentsOfDirectory(
               at: folder, includingPropertiesForKeys: nil) {
            for entry in entries {
                try? FileManager.default.removeItem(at: entry)
            }
        }
        call.resolve()
    }

    private static func removeEntry(id: String, in folder: URL) {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id).payload"))
        try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id).json"))
    }

    /// A `.payload` with no `.json` sibling is invisible to every consumer
    /// and used to accumulate forever. The hour of grace covers the
    /// extension's write order (payload first, sidecar second), so a share
    /// being written right now is not swept mid-write.
    private static func sweepOrphanedPayloads(in folder: URL) {
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

    private static func sidecarURLs() -> [URL] {
        guard let folder = sharedFolderURL(),
              let entries = try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: nil) else { return [] }
        return entries.filter { $0.pathExtension == "json" }
    }

    private static func sharedFolderURL() -> URL? {
        guard let base = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }
        let folder = base.appendingPathComponent(folderName, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}
