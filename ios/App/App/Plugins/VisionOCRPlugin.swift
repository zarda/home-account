import Foundation
import Capacitor
import Vision
import UIKit

@objc(VisionOCRPlugin)
public class VisionOCRPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VisionOCRPlugin"
    public let jsName = "VisionOCR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]
    
    /// Check if Vision OCR is available on this device
    @objc func isAvailable(_ call: CAPPluginCall) {
        // True when the iOS build is running on macOS (Apple Silicon "Designed
        // for iPad" or Mac Catalyst) — the web layer uses this to prefer the
        // newer cloud models over the basic OCR parsing pipeline.
        let processInfo = ProcessInfo.processInfo
        let isMacEnvironment = processInfo.isMacCatalystApp || processInfo.isiOSAppOnMac

        // Vision framework is available on iOS 13+
        if #available(iOS 13.0, *) {
            call.resolve([
                "available": true,
                "isMacEnvironment": isMacEnvironment,
                "supportedLanguages": Self.supportedRecognitionLanguages()
            ])
        } else {
            call.resolve([
                "available": false,
                "isMacEnvironment": isMacEnvironment,
                "supportedLanguages": [String]()
            ])
        }
    }

    /// Everything this device can read, asked of a request configured exactly
    /// like the one recognizeText runs — the answer depends on both the
    /// recognition level and the revision. The web layer routes on this rather
    /// than on a list of languages shipped in the app.
    @available(iOS 13.0, *)
    private static func supportedRecognitionLanguages() -> [String] {
        // The class method that answers this on iOS 13 and 14 has been
        // deprecated since iOS 15; older devices report nothing and the caller
        // reads that as "unknown".
        guard #available(iOS 15.0, *) else { return [] }

        let request = VNRecognizeTextRequest()
        configure(request)
        return (try? request.supportedRecognitionLanguages()) ?? []
    }

    /// Shared so the languages isAvailable reports are the ones recognizeText
    /// will actually use.
    @available(iOS 13.0, *)
    private static func configure(_ request: VNRecognizeTextRequest) {
        request.recognitionLevel = .accurate

        // Newest revision this OS offers: each one has read more scripts than
        // the last, and automatic language detection is a no-op before
        // revision 3.
        if let latestRevision = VNRecognizeTextRequest.supportedRevisions.max() {
            request.revision = latestRevision
        }

        if #available(iOS 16.0, *), request.revision >= VNRecognizeTextRequestRevision3 {
            request.automaticallyDetectsLanguage = true
        }

        // Correction rewrites recognized characters to fit the language model it
        // runs against, so a receipt in a script that model does not cover comes
        // back as confident nonsense in a script it does. What matters on a
        // receipt is amounts, dates and merchant names, and a lexicon improves
        // none of them. (#142)
        request.usesLanguageCorrection = false
    }
    
    /// Recognize text from a base64-encoded image
    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let imageBase64 = call.getString("image") else {
            call.reject("Missing image parameter")
            return
        }
        
        // Any data URL prefix goes; the reasoning lives with the strip.
        let base64String = DataURL.stripBase64Prefix(imageBase64)
        
        guard let imageData = Data(base64Encoded: base64String),
              let image = UIImage(data: imageData),
              let cgImage = image.cgImage else {
            call.reject("Failed to decode image")
            return
        }
        
        // Languages the caller wants tried first, if it has any reason to
        // prefer one. Empty is the normal case.
        let languages = call.getArray("languages", String.self) ?? []

        // Perform text recognition
        if #available(iOS 13.0, *) {
            performTextRecognition(cgImage: cgImage, languages: languages, call: call)
        } else {
            call.reject("Vision OCR requires iOS 13 or later")
        }
    }
    
    @available(iOS 13.0, *)
    private func performTextRecognition(cgImage: CGImage, languages: [String], call: CAPPluginCall) {
        let request = VNRecognizeTextRequest { [weak self] request, error in
            if let error = error {
                call.reject("Text recognition failed: \(error.localizedDescription)")
                return
            }
            
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                call.reject("No text observations found")
                return
            }
            
            // Extract text and bounding boxes
            var textBlocks: [[String: Any]] = []
            var fullText = ""
            var totalConfidence: Float = 0
            var blockCount = 0
            
            for observation in observations {
                guard let topCandidate = observation.topCandidates(1).first else { continue }
                
                let text = topCandidate.string
                let confidence = topCandidate.confidence
                
                // Get bounding box (normalized coordinates)
                let boundingBox = observation.boundingBox
                
                textBlocks.append([
                    "text": text,
                    "confidence": confidence,
                    "boundingBox": [
                        "x": boundingBox.origin.x,
                        "y": boundingBox.origin.y,
                        "width": boundingBox.width,
                        "height": boundingBox.height
                    ]
                ])
                
                fullText += text + "\n"
                totalConfidence += confidence
                blockCount += 1
            }
            
            let averageConfidence = blockCount > 0 ? totalConfidence / Float(blockCount) : 0
            
            call.resolve([
                "text": fullText.trimmingCharacters(in: .whitespacesAndNewlines),
                "blocks": textBlocks,
                "confidence": averageConfidence,
                "blockCount": blockCount
            ])
        }
        
        Self.configure(request)

        // recognitionLanguages orders the languages Vision works through; it
        // never widens them, so anything missing from a non-empty list is a
        // language Vision stops reading. A caller hint is therefore appended to
        // everything the device supports rather than substituted for it — the
        // fixed list of three we used to send here is why receipts in any other
        // script came back empty or transliterated. (#142)
        if #available(iOS 15.0, *), !languages.isEmpty {
            let supported = (try? request.supportedRecognitionLanguages()) ?? []
            request.recognitionLanguages = languages + supported.filter { !languages.contains($0) }
        }

        // Create and execute the request handler
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
            } catch {
                call.reject("Failed to perform text recognition: \(error.localizedDescription)")
            }
        }
    }
}
