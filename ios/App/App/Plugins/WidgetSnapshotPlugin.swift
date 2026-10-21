import Foundation
import Capacitor
import WidgetKit

/// Hands the home-screen widget the snapshot the web layer composed.
///
/// The payload arrives as one JSON string rather than an object: Capacitor
/// bridges an object through JSObject, which retypes numbers on the way, so
/// the file would no longer be the JSON the web wrote. A string crosses the
/// bridge byte for byte.
///
/// It is decoded before it is written (`WidgetSnapshot.write`). The widget
/// runs in its own process and has no way to report a file it cannot read —
/// it would just fall back to the app's name — so a bug in the web writer
/// must fail loudly here, as a rejected call, and leave the last readable
/// snapshot in place.
///
/// It also tells the web layer when a tap on the widget opened the app
/// (`tapped`), which then opens the dashboard.
@objc(WidgetSnapshotPlugin)
public class WidgetSnapshotPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetSnapshotPlugin"
    public let jsName = "WidgetSnapshot"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    /// A tap on the widget opens the app with `WidgetSnapshot.tapURL`. A tap
    /// that started the app can arrive before the bridge loads this plugin,
    /// so the URL Capacitor last opened is read here, and every open after
    /// this point is observed. The event is retained until a listener
    /// attaches, so a cold start's tap waits for the web layer to arm.
    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidOpenURL(_:)),
            name: .capacitorOpenURL,
            object: nil
        )
        if let url = ApplicationDelegateProxy.shared.lastURL {
            forwardIfTap(url)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func appDidOpenURL(_ notification: Notification) {
        guard
            let object = notification.object as? [String: Any],
            let url = object["url"] as? URL
        else { return }
        forwardIfTap(url)
    }

    /// The web layer reads nothing from the payload. It names the event in
    /// the native console, whose line for an event prints only the payload,
    /// and an empty one is what every resolved `write` prints too.
    private func forwardIfTap(_ url: URL) {
        guard WidgetSnapshot.isTap(url) else { return }
        notifyListeners("tapped", data: ["source": "widget"], retainUntilConsumed: true)
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let snapshot = call.getString("snapshot") else {
            call.reject("invalid", "invalid")
            return
        }
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: WidgetSnapshot.appGroupId) else {
            call.reject("unavailable", "unavailable")
            return
        }
        do {
            try WidgetSnapshot.write(Data(snapshot.utf8), to: container)
        } catch WidgetSnapshotError.invalid {
            call.reject("invalid", "invalid")
            return
        } catch {
            // Not a bad payload — `WidgetSnapshot.write` already validated
            // that before touching the disk — so this is the atomic write
            // itself failing (e.g. the disk is full). Distinct from
            // `invalid` so the web layer does not read it as its own bug,
            // and the underlying error rides along instead of being dropped.
            call.reject("unavailable", "unavailable", error)
            return
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
