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

    @Guide(description: "Purchase date as YYYY-MM-DD on the Gregorian calendar, converted if the receipt prints another calendar or era, or an empty string if not present")
    var date: String

    @Guide(description: "Final total amount paid as a decimal number, using a dot for the decimal mark and no digit grouping")
    var amount: Double

    @Guide(description: "ISO 4217 alphabetic currency code for that total, taken from the currency sign or wording the receipt uses, or an empty string if the receipt does not say")
    var currency: String

    @Guide(description: "The id of the single best matching category from the provided list — the part of its line before the colon — or an empty string if none fits")
    var category: String

    @Guide(description: "Short summary of the purchased items, one item per line")
    var details: String

    @Guide(description: "Branch name and/or street address exactly as the receipt prints it, in its own script — never translated or inferred from the merchant name — or an empty string if none is printed")
    var location: String

    @Guide(description: "ISO 3166-1 alpha-2 code of the country the receipt was issued in, concluded from the printed address, tax or registration number, phone number format, currency sign and the receipt's own language — or an empty string if it cannot be told, never a default")
    var country: String
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

            // No language is named here. Listing three only ever gave the model
            // a reason to read a fourth as one of them. (#145)
            var instructions = """
            You extract structured transaction data from receipt text produced by OCR. \
            The text may contain recognition errors. \
            The amount must be the final total that was paid. \
            Keep the merchant name and the item text exactly as printed, in the script they \
            were printed in — never translate or transliterate them. \
            The location is only what the receipt prints; never infer it from the merchant name.
            """
            if !categories.isEmpty {
                // One entry per line — display names may contain commas — and
                // each line is `id: name`. The id is the one language-neutral
                // token, so that is what the model is told to answer with.
                instructions += " Pick the category only from this list and answer with its id, the part before the colon:\n\(categories.joined(separator: "\n"))"
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
                        "details": receipt.details,
                        "location": receipt.location,
                        "country": receipt.country
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
