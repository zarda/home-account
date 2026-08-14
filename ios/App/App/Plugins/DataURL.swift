import Foundation

/// Base64 image payloads travel as data URLs, and the declared mediatype
/// cannot be trusted — a shared photo can arrive labelled
/// application/octet-stream — so the strip accepts any prefix rather than
/// anchoring on data:image/, which would leave the prefix in place and turn
/// the payload into invalid base64.
enum DataURL {
    static func stripBase64Prefix(_ payload: String) -> String {
        payload.replacingOccurrences(
            of: "data:[^;,]+;base64,",
            with: "",
            options: .regularExpression
        )
    }
}
