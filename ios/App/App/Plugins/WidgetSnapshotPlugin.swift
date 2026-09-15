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
@objc(WidgetSnapshotPlugin)
public class WidgetSnapshotPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetSnapshotPlugin"
    public let jsName = "WidgetSnapshot"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

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
