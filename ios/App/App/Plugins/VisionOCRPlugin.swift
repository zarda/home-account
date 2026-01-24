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
        // Vision framework is available on iOS 13+
        if #available(iOS 13.0, *) {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false])
        }
    }
    
    /// Recognize text from a base64-encoded image
    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let imageBase64 = call.getString("image") else {
            call.reject("Missing image parameter")
            return
        }
        
        // Remove data URL prefix if present
        let base64String = imageBase64.replacingOccurrences(
            of: "data:image/[^;]+;base64,",
            with: "",
            options: .regularExpression
        )
        
        guard let imageData = Data(base64Encoded: base64String),
              let image = UIImage(data: imageData),
              let cgImage = image.cgImage else {
            call.reject("Failed to decode image")
            return
        }
        
        // Get preferred languages from call or use defaults
        let languages = call.getArray("languages", String.self) ?? ["en-US", "ja-JP", "zh-Hant"]
        
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
        
        // Configure the request
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        
        // Set recognition languages if available (iOS 16+)
        if #available(iOS 16.0, *) {
            request.recognitionLanguages = languages
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
