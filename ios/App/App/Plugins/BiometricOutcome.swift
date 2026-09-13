import Foundation
import LocalAuthentication

/// The vocabulary the unlock screen is written against. LocalAuthentication
/// reports a dozen distinct failures, but the web layer only ever branches
/// four ways — offer the PIN again, say biometry is locked out until a
/// passcode unlock, stop offering biometry at all, or retry — so the codes are
/// collapsed here rather than repeated in a switch on the other side of the
/// bridge. They travel as strings because that is all a Capacitor rejection
/// carries, so renaming one silently breaks the web layer that switches on
/// them.
///
/// Foundation and LocalAuthentication only: the file is compiled into the
/// AppTests logic bundle as well as the app, and that bundle links no
/// Capacitor.
enum BiometricOutcome {
    static func code(for error: Error?) -> String {
        // evaluatePolicy reports an NSError; it is readable as an LAError only
        // because LocalAuthentication bridges the domain. Anything from
        // another domain — or no error at all, which should not reach here —
        // is indistinguishable from a plain refusal to the caller.
        guard let code = (error as? LAError)?.code else { return "failed" }

        switch code {
        case .userCancel, .userFallback, .systemCancel, .appCancel:
            // The fallback title is blanked out by the plugin, so
            // `.userFallback` is not a request for the device passcode; it is
            // one more way the sheet went away without an answer.
            return "cancelled"
        case .biometryLockout, .touchIDLockout:
            return "lockedOut"
        case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet,
             .touchIDNotAvailable, .touchIDNotEnrolled:
            // Biometry is enrolled against the device passcode, so a device
            // without one has nothing to unlock with whatever its hardware.
            // The TouchID cases are the pre-iOS-11 names for the two above;
            // deprecated, but still what a code can carry on the wire.
            return "unavailable"
        case .authenticationFailed, .invalidContext, .notInteractive, .companionNotAvailable:
            // None of the other buckets fit: a wrong biometric read, a
            // context reused after invalidation, a blocked interactive
            // prompt and a missing paired device are all worth no more than
            // a retry to the caller.
            return "failed"
        @unknown default:
            // LAError.Code is not frozen; a code this SDK has never seen
            // gets the same retry outcome as the named cases above.
            return "failed"
        }
    }

    static func biometry(_ type: LABiometryType) -> String {
        switch type {
        case .faceID:
            return "faceId"
        case .touchID:
            return "touchId"
        default:
            // `.opticID`, and whatever a later SDK adds, have no prompt copy
            // on the web side; a biometry the app cannot name is worth no
            // more to it than none at all.
            return "none"
        }
    }
}
