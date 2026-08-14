import UIKit
import UniformTypeIdentifiers

/// Receives shared images, PDFs and CSVs, copies them into the App Group
/// container, and dismisses itself after a short confirmation.
///
/// The host app is deliberately NOT auto-opened: the responder-chain openURL
/// workaround extensions use for that is private-API-adjacent and an App
/// Review risk. The handoff is passive — ShareIntakePlugin drains the
/// container the next time the app becomes active.
///
/// The App Group id and folder name are duplicated in ShareIntakePlugin.swift
/// (the two targets share no code). Change them together.
final class ShareViewController: UIViewController {

    private static let appGroupId = "group.com.homeaccount.app"
    private static let folderName = "SharedImports"

    /// Same set the manifest's share_target accepts on the web. `.jpeg`
    /// leads so loadFileRepresentation asks the provider to transcode what
    /// it can — an iPhone camera HEIC arrives as JPEG; `.image` stays right
    /// behind it for images with no JPEG representation.
    private static let acceptedTypes: [UTType] = [.jpeg, .image, .pdf, .commaSeparatedText]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        showConfirmationCard()

        saveAttachments { [weak self] savedCount in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                if savedCount == 0 {
                    self?.extensionContext?.cancelRequest(withError: NSError(
                        domain: "ShareIntake", code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Nothing shareable was received"]))
                } else {
                    self?.extensionContext?.completeRequest(returningItems: nil)
                }
            }
        }
    }

    // MARK: - Attachment intake

    private func saveAttachments(completion: @escaping (Int) -> Void) {
        guard let container = Self.sharedFolderURL() else {
            completion(0)
            return
        }

        let providers = (extensionContext?.inputItems ?? [])
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }

        let group = DispatchGroup()
        var saved = 0
        let lock = NSLock()

        for provider in providers {
            guard let type = Self.acceptedTypes.first(where: {
                provider.hasItemConformingToTypeIdentifier($0.identifier)
            }) else { continue }

            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                defer { group.leave() }
                guard let url else { return }
                // The URL is a temporary file that dies with this handler, so
                // the copy happens here and now.
                if Self.stash(fileAt: url, as: type, into: container) {
                    lock.lock()
                    saved += 1
                    lock.unlock()
                }
            }
        }

        group.notify(queue: .main) { completion(saved) }
    }

    /// Copies the payload and writes a JSON sidecar the plugin reads:
    /// `<uuid>.payload` + `<uuid>.json` `{ name, mimeType, payload, receivedAt }`.
    private static func stash(fileAt url: URL, as type: UTType, into container: URL) -> Bool {
        let id = UUID().uuidString
        let payloadURL = container.appendingPathComponent("\(id).payload")
        let sidecarURL = container.appendingPathComponent("\(id).json")

        // The matched type is abstract — `.image` is `public.image`, which
        // declares no MIME tag — so ask the delivered file what it concretely
        // is. The abstract type's own MIME is the fallback, octet-stream last.
        let concreteType = (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType
            ?? UTType(filenameExtension: url.pathExtension)
        let mimeType = concreteType?.preferredMIMEType
            ?? type.preferredMIMEType
            ?? "application/octet-stream"

        let sidecar: [String: String] = [
            "name": url.lastPathComponent,
            "mimeType": mimeType,
            "payload": payloadURL.lastPathComponent,
            // Epoch milliseconds as a string: the sidecar is string-typed
            // throughout, and the consumer's claim window needs an age.
            "receivedAt": String(Int64(Date().timeIntervalSince1970 * 1000))
        ]

        do {
            try FileManager.default.copyItem(at: url, to: payloadURL)
            let data = try JSONSerialization.data(withJSONObject: sidecar)
            try data.write(to: sidecarURL, options: .atomic)
            return true
        } catch {
            try? FileManager.default.removeItem(at: payloadURL)
            try? FileManager.default.removeItem(at: sidecarURL)
            return false
        }
    }

    private static func sharedFolderURL() -> URL? {
        guard let base = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }
        let folder = base.appendingPathComponent(folderName, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    // MARK: - Confirmation card

    private func showConfirmationCard() {
        let card = UIView()
        card.backgroundColor = UIColor.systemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false

        let icon = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
        icon.tintColor = .systemGreen
        icon.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.text = "Saved — open Home Account"
        label.font = UIFont.preferredFont(forTextStyle: .callout)
        label.textColor = .label
        label.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(icon)
        card.addSubview(label)
        view.addSubview(card)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            icon.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            icon.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            icon.heightAnchor.constraint(equalToConstant: 22),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            label.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12)
        ])
    }
}
