import Foundation
import Capacitor
import UIKit

/// Surfaces files the Share Extension saved into the App Group container.
///
/// The extension writes `<uuid>.payload` + `<uuid>.json` sidecars (see
/// ShareViewController.swift — the two targets share no code, so the App
/// Group id, folder name and sidecar shape are duplicated there; change them
/// together). This plugin counts and drains them, and pings the web layer on
/// every app activation, which is the first moment a share made in another
/// app can be noticed.
@objc(ShareIntakePlugin)
public class ShareIntakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareIntakePlugin"
    public let jsName = "ShareIntake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPendingShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingShares", returnType: CAPPluginReturnPromise)
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

        for sidecarURL in Self.sidecarURLs() {
            guard
                let sidecarData = try? Data(contentsOf: sidecarURL),
                let sidecar = (try? JSONSerialization.jsonObject(with: sidecarData)) as? [String: String],
                let payloadName = sidecar["payload"],
                let folder = Self.sharedFolderURL()
            else { continue }

            let payloadURL = folder.appendingPathComponent(payloadName)
            if let payload = try? Data(contentsOf: payloadURL) {
                files.append([
                    "name": sidecar["name"] ?? payloadName,
                    "mimeType": sidecar["mimeType"] ?? "application/octet-stream",
                    "base64": payload.base64EncodedString()
                ])
            }

            // Consumed (or unreadable — either way it must not wedge the
            // queue forever): both halves go.
            try? FileManager.default.removeItem(at: payloadURL)
            try? FileManager.default.removeItem(at: sidecarURL)
        }

        call.resolve(["files": files])
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
