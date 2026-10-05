import Foundation
import Security
import os

/// Credentials and the device's stable identity, in the Keychain.
///
/// `ThisDeviceOnly` on purpose: the refresh token is a long-lived credential for
/// a machine that can run arbitrary code, and restoring it onto a different
/// device from an iCloud backup would silently extend that reach.
nonisolated struct TokenStore {
    private static let credentialLock = NSRecursiveLock()
    // Protected by credentialLock; rotation does not start a new account lifetime.
    nonisolated(unsafe) private static var credentialVersions: [String: Int] = [:]
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
        nonmutating set {
            Self.credentialLock.lock()
            defer { Self.credentialLock.unlock() }
            Self.credentialVersions[service, default: 0] &+= 1
            write(.refreshToken, newValue)
        }
    }

    var credentialVersion: Int {
        Self.credentialLock.lock()
        defer { Self.credentialLock.unlock() }
        return Self.credentialVersions[service, default: 0]
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
        Self.credentialLock.lock()
        defer { Self.credentialLock.unlock() }
        Self.credentialVersions[service, default: 0] &+= 1
        write(.refreshToken, nil)
        write(.accountEmail, nil)
    }

    /// 通知动作和主界面可有不同客户端；迟到刷新只替换它实际使用的凭据。
    func replaceRefreshToken(_ replacement: String, matching expected: String, credentialVersion version: Int? = nil) -> Bool {
        Self.credentialLock.lock()
        defer { Self.credentialLock.unlock() }
        if let version, version != Self.credentialVersions[service, default: 0] { return false }
        guard read(.refreshToken) == expected else { return false }
        return write(.refreshToken, replacement) == errSecSuccess
    }

    func clearCredentials(matching expected: String, credentialVersion version: Int? = nil) -> Bool {
        Self.credentialLock.lock()
        defer { Self.credentialLock.unlock() }
        if let version, version != Self.credentialVersions[service, default: 0] { return false }
        guard read(.refreshToken) == expected else { return false }
        clearCredentials()
        return true
    }

    // MARK: - Keychain plumbing

    private func read(_ key: Key) -> String? {
        Self.credentialLock.lock()
        defer { Self.credentialLock.unlock() }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        // `errSecItemNotFound` is the ordinary "nothing stored yet" answer.
        if status != errSecSuccess && status != errSecItemNotFound {
            AppLog.network.error("Keychain read failed status=\(status, privacy: .public) key=\(key.rawValue, privacy: .public)")
        }
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Returns the Keychain's own status rather than discarding it.
    ///
    /// The status used to be dropped on the floor, which made a failed write look
    /// exactly like a successful one: login appeared to work, the token was only
    /// ever in memory, and the next launch had nothing to restore.
    @discardableResult
    private func write(_ key: Key, _ value: String?) -> OSStatus {
        Self.credentialLock.lock()
        defer { Self.credentialLock.unlock() }
        let query = baseQuery(key)
        guard let value else {
            let status = SecItemDelete(query as CFDictionary)
            if status != errSecSuccess && status != errSecItemNotFound {
                AppLog.network.error("Keychain delete failed status=\(status, privacy: .public) key=\(key.rawValue, privacy: .public)")
            }
            return status
        }
        let data = Data(value.utf8)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return errSecSuccess }
        var create = query
        create[kSecValueData as String] = data
        create[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(create as CFDictionary, nil)
        if addStatus != errSecSuccess {
            AppLog.network.error("Keychain write failed status=\(addStatus, privacy: .public) updateStatus=\(updateStatus, privacy: .public) key=\(key.rawValue, privacy: .public)")
        }
        return addStatus
    }

    private func baseQuery(_ key: Key) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
    }
}
