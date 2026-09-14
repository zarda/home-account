import XCTest
import LocalAuthentication

// The outcome codes the web layer switches on. LocalAuthentication reports a
// dozen distinct failures that the unlock screen only ever needs to tell
// apart four ways, and the plugin itself cannot be exercised here — a
// CAPPluginCall needs a live bridge — so the mapping is the seam that carries
// the whole contract and the only part that can be pinned down.

final class BiometricOutcomeTests: XCTestCase {
    func testUserCancelIsCancelled() {
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.userCancel)), "cancelled")
        // The sheet taken away by the system or by the app itself leaves the
        // caller exactly where a dismissal does: no answer, nothing to report.
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.systemCancel)), "cancelled")
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.appCancel)), "cancelled")
    }

    func testUserFallbackIsCancelled() {
        // The fallback button is blanked out, so this only arrives when the
        // sheet is dismissed some other way — never as a request for a
        // passcode the app does not want the system to collect.
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.userFallback)), "cancelled")
    }

    func testBiometryLockoutIsLockedOut() {
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.biometryLockout)), "lockedOut")
    }

    func testBiometryNotAvailableIsUnavailable() {
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.biometryNotAvailable)), "unavailable")
    }

    func testBiometryNotEnrolledIsUnavailable() {
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.biometryNotEnrolled)), "unavailable")
    }

    func testPasscodeNotSetIsUnavailable() {
        // Biometry is registered against the device passcode; without one
        // there is nothing to unlock with, however capable the hardware is.
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.passcodeNotSet)), "unavailable")
    }

    func testAuthenticationFailedIsFailed() {
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.authenticationFailed)), "failed")
    }

    func testAnUnrecognizedErrorIsFailed() {
        XCTAssertEqual(BiometricOutcome.code(for: LAError(.invalidContext)), "failed")
        XCTAssertEqual(BiometricOutcome.code(for: NSError(domain: "com.homeaccount.other", code: 42)), "failed")
        XCTAssertEqual(BiometricOutcome.code(for: nil), "failed")
    }

    func testBridgedNSErrorIsReadAsItsLACode() {
        // evaluatePolicy hands back an NSError, not an LAError value; the two
        // are the same thing only because LocalAuthentication bridges them.
        let raw = NSError(domain: LAErrorDomain, code: LAError.userCancel.rawValue)
        XCTAssertEqual(BiometricOutcome.code(for: raw), "cancelled")
    }

    func testFaceIDAndTouchIDAreNamed() {
        XCTAssertEqual(BiometricOutcome.biometry(.faceID), "faceId")
        XCTAssertEqual(BiometricOutcome.biometry(.touchID), "touchId")
    }

    func testNoBiometryIsNone() {
        XCTAssertEqual(BiometricOutcome.biometry(.none), "none")
    }
}
