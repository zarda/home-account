import Foundation
import Capacitor
import LocalAuthentication

/// Face ID / Touch ID as a second way past the lock screen. The app's own PIN
/// stays the only fallback, so the policy is `deviceOwnerAuthenticationWithBiometrics`
/// and never `deviceOwnerAuthentication`: the latter drops through to the
/// device passcode on its own, which would let anyone holding an unlocked
/// phone past a lock that is meant to guard the account on that phone. For the
/// same reason `localizedFallbackTitle` is blanked out — a non-empty title is
/// the system's offer to collect the passcode, and an unset one restores the
/// default offer rather than removing it.
///
/// Every call builds its own `LAContext`. A context caches the result of the
/// evaluation it has already run and answers a second `evaluatePolicy` from
/// that cache without showing a sheet, so a shared one would wave a locked app
/// through on the strength of an unlock from minutes ago.
@objc(BiometricAuthPlugin)
public class BiometricAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BiometricAuthPlugin"
    public let jsName = "BiometricAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    /// Report whether biometry can be evaluated right now, and which kind the
    /// device offers, so the settings screen can name it before enrolling.
    @objc func isAvailable(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        // `biometryType` is `.none` until `canEvaluatePolicy` has run against
        // the context — `evaluatePolicy` is not what populates it, so it is
        // readable right after the call above.
        call.resolve([
            "available": available,
            "biometry": BiometricOutcome.biometry(context.biometryType),
            "reason": available ? "" : BiometricOutcome.code(for: error)
        ])
    }

    /// Present the biometric sheet and report the single outcome the unlock
    /// screen acts on.
    @objc func authenticate(_ call: CAPPluginCall) {
        // The sheet's caption is written and translated on the web side; there
        // is no English default here to fall back to. A missing reason is a
        // caller bug, not a failed scan, so it is rejected as `unavailable`
        // rather than `failed` — the lock screen would otherwise word this as
        // "didn't recognize you", which is not what happened.
        guard let reason = call.getString("reason"), !reason.isEmpty else {
            call.reject("unavailable", "unavailable")
            return
        }

        let context = LAContext()
        context.localizedFallbackTitle = ""
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, error in
            // Keeps this LAContext retained for as long as the completion
            // closure runs, regardless of what evaluatePolicy does on its own.
            withExtendedLifetime(context) {
                guard success else {
                    // The mapped code is sent as the message as well: a
                    // Capacitor rejection reaches JS as an Error, and the
                    // caller reads whichever of the two it happens to hold.
                    let code = BiometricOutcome.code(for: error)
                    call.reject(code, code)
                    return
                }
                call.resolve(["success": true])
            }
        }
    }
}
