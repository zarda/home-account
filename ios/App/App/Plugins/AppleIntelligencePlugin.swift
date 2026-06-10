import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct ReceiptExtraction {
    @Guide(description: "Merchant or store name shown on the receipt")
    var merchant: String

    @Guide(description: "Purchase date in YYYY-MM-DD format, or an empty string if not present")
    var date: String

    @Guide(description: "Final total amount paid as a decimal number")
    var amount: Double

    @Guide(description: "ISO 4217 currency code such as USD, JPY, EUR, TWD")
    var currency: String

    @Guide(description: "The single best matching category name from the provided list, or an empty string if none fits")
    var category: String

    @Guide(description: "Short summary of the purchased items, one item per line")
    var details: String
}
#endif

/// Bridges Apple's on-device foundation model (Apple Intelligence) to the web
/// layer. Receipt text recognized by Vision OCR is structured into transaction
/// data entirely on device — no API key or network required.
///
/// Requires building with the iOS 26 SDK; on older SDKs the plugin compiles to
/// a stub that reports the model as unavailable.
@objc(AppleIntelligencePlugin)
public class AppleIntelligencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleIntelligencePlugin"
    public let jsName = "AppleIntelligence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parseReceiptText", returnType: CAPPluginReturnPromise)
    ]

    /// Check whether the on-device foundation model can be used right now.
    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true, "reason": ""])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": Self.describe(reason)])
            @unknown default:
                call.resolve(["available": false, "reason": "unknown"])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "osNotSupported"])
    }

    /// Structure OCR receipt text into transaction data with the on-device model.
    @objc func parseReceiptText(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("Missing text parameter")
            return
        }
        let categories = call.getArray("categories", String.self) ?? []

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else {
                call.reject("Apple Intelligence model is not available on this device")
                return
            }

            var instructions = """
            You extract structured transaction data from receipt text produced by OCR. \
            The text may contain recognition errors and may be in English, Japanese, or Chinese. \
            The amount must be the final total that was paid.
            """
            if !categories.isEmpty {
                instructions += " Choose the category only from this list: \(categories.joined(separator: ", "))."
            }

            Task {
                do {
                    let session = LanguageModelSession(instructions: instructions)
                    let prompt = "Extract the transaction from this receipt text:\n\n\(text)"
                    let response = try await session.respond(to: prompt, generating: ReceiptExtraction.self)
                    let receipt = response.content
                    call.resolve([
                        "merchant": receipt.merchant,
                        "date": receipt.date,
                        "amount": receipt.amount,
                        "currency": receipt.currency,
                        "category": receipt.category,
                        "details": receipt.details
                    ])
                } catch {
                    call.reject("Apple Intelligence generation failed: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("Apple Intelligence requires iOS 26 / macOS 26 or later")
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            return "deviceNotEligible"
        case .appleIntelligenceNotEnabled:
            return "appleIntelligenceNotEnabled"
        case .modelNotReady:
            return "modelNotReady"
        @unknown default:
            return "unknown"
        }
    }
    #endif
}
