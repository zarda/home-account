import Foundation
import Capacitor
import UIKit

/// Surfaces files the Share Extension saved into the App Group container.
///
/// The Capacitor shell only: it resolves the App Group folder, pings the web
/// layer on every app activation (the first moment a share made in another
/// app can be noticed), and forwards every file operation to
/// ShareIntakeStore — which is pure Foundation so the XCTest target can
/// drive it against a temp directory.
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
        guard let folder = Self.sharedFolderURL() else {
            call.resolve(["count": 0])
            return
        }
        call.resolve(["count": ShareIntakeStore.pendingCount(in: folder)])
    }

    @objc func consumePendingShares(_ call: CAPPluginCall) {
        guard let folder = Self.sharedFolderURL() else {
            call.resolve(["files": [[String: String]]()])
            return
        }
        call.resolve(["files": ShareIntakeStore.collectPendingShares(in: folder)])
    }

    @objc func completePendingShares(_ call: CAPPluginCall) {
        if let folder = Self.sharedFolderURL() {
            ShareIntakeStore.completeEntries(
                ids: call.getArray("ids", String.self) ?? [],
                in: folder
            )
        }
        call.resolve()
    }

    @objc func clearPendingShares(_ call: CAPPluginCall) {
        if let folder = Self.sharedFolderURL() {
            ShareIntakeStore.clearEntries(in: folder)
        }
        call.resolve()
    }

    private static func sharedFolderURL() -> URL? {
        guard let base = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }
        let folder = base.appendingPathComponent(folderName, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}
