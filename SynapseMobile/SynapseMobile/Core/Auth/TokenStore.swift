import Foundation
import Security

/// Credentials and the device's stable identity, in the Keychain.
///
/// `ThisDeviceOnly` on purpose: the refresh token is a long-lived credential for
/// a machine that can run arbitrary code, and restoring it onto a different
/// device from an iCloud backup would silently extend that reach.
struct TokenStore {
    private let service: String

    init(service: String = "com.liy.SynapseMobile") {
        self.service = service
    }

    private enum Key: String {
        case refreshToken
        case clientInstanceId
        case accountEmail
    }

    var refreshToken: String? {
        get { read(.refreshToken) }
        nonmutating set { write(.refreshToken, newValue) }
    }

    var accountEmail: String? {
        get { read(.accountEmail) }
        nonmutating set { write(.accountEmail, newValue) }
    }

    /// Identifies this installation to the cloud. Stable across launches and
    /// logins — the desktop's `clientInstanceId` works the same way — so the
    /// server can keep routing and presence for this device.
    var clientInstanceId: String {
        if let existing = read(.clientInstanceId) { return existing }
        let created = UUID().uuidString
        write(.clientInstanceId, created)
        return created
    }

    func clearCredentials() {
        write(.refreshToken, nil)
        write(.accountEmail, nil)
    }

    // MARK: - Keychain plumbing

    private func read(_ key: Key) -> String? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func write(_ key: Key, _ value: String?) {
        let query = baseQuery(key)
        guard let value else {
            SecItemDelete(query as CFDictionary)
            return
        }
        let data = Data(value.utf8)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        var create = query
        create[kSecValueData as String] = data
        create[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(create as CFDictionary, nil)
    }

    private func baseQuery(_ key: Key) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
    }
}
