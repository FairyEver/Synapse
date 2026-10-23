import Foundation

enum InternalMailReference {
    static func parse(_ url: URL) -> String? {
        let prefix = "synapse://mail-internal/"
        let raw = url.absoluteString
        guard raw.range(of: "^synapse://mail-internal/[A-Za-z0-9_-]{1,200}$", options: .regularExpression) != nil else {
            return nil
        }
        return String(raw.dropFirst(prefix.count))
    }
}
