import Foundation
import Observation

/// Which computer this phone is on.
///
/// The relay can carry two computers at once, and until this existed the phone had no
/// way to say which one it meant: it took whatever list order the cloud happened to
/// return and re-took it every time that computer went away. The order the cloud
/// returns is the registry's own, sorted by an id nobody chose, so "which computer am
/// I looking at" was effectively a coin flip that could land somewhere else between
/// two glances at the screen.
///
/// So the answer is written down. A computer the reader picked and a computer the
/// phone adopted on its first launch are the same kind of fact from then on, and
/// neither is ever replaced without being asked — see `resolve(online:)`.
///
/// Stored locally and never uploaded: the cloud only ever learns which computer an
/// individual intent is addressed to, which is the whole of what it needs.
@MainActor
@Observable
final class ViewedDesktopPreference {
    private(set) var clientInstanceId: String?

    private let defaults: UserDefaults
    /// Last name seen for each computer.
    ///
    /// The name of the computer being viewed arrives with its session list, and that
    /// list is exactly what a computer that has gone away can no longer send. Without
    /// a memory, "the computer you are on has gone offline" would have to be said
    /// about a string of hex.
    private var names: [String: String]

    private static let viewedKey = "SynapseViewedDesktopClientInstanceId"
    private static let namesKey = "SynapseDesktopNames"
    /// Room for any real account, bounded so that a long-lived install which has been
    /// signed into several accounts cannot grow this without limit.
    private static let maxRememberedNames = 8

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.clientInstanceId = defaults.string(forKey: Self.viewedKey)
        self.names = defaults.data(forKey: Self.namesKey)
            .flatMap { try? JSONDecoder().decode([String: String].self, from: $0) } ?? [:]
    }

    // MARK: - Which computer

    /// The computer to be on, given the ones that are reachable.
    ///
    /// This is the whole rule, and it is one line on purpose. There are exactly two
    /// ways the viewed computer changes: there was none, so the first reachable one is
    /// adopted — nothing is being taken away from anybody — or the reader asked. A
    /// remembered computer that is not in `online` is *kept*: the screen says it is
    /// offline and offers the switch, rather than moving the reader somewhere they did
    /// not ask to go while they are looking at a terminal.
    @discardableResult
    func resolve(online: [String]) -> String? {
        let next = clientInstanceId ?? online.first
        if let next, next != clientInstanceId {
            clientInstanceId = next
            defaults.set(next, forKey: Self.viewedKey)
        }
        return next
    }

    /// The reader picked this one — the switch menu, or a notification tap.
    ///
    /// Honoured even when the computer is not reachable. A notification that names a
    /// computer is the reader saying which one they mean; landing them on a different
    /// one instead is the behaviour this type exists to remove.
    func view(_ clientInstanceId: String) {
        guard clientInstanceId != self.clientInstanceId else { return }
        self.clientInstanceId = clientInstanceId
        defaults.set(clientInstanceId, forKey: Self.viewedKey)
    }

    /// The computers the switch menu offers: everything reachable except the one
    /// already being viewed.
    ///
    /// Empty means the row is not a control. Note what this is *not*: "more than one
    /// computer is online". A phone sitting on a computer that has gone offline has to
    /// be able to reach the one other computer, and that is the case with a single
    /// reachable computer — the single case where the row is the only way out.
    static func switchTargets(online: [String], viewing: String?) -> [String] {
        online.filter { $0 != viewing }
    }

    // MARK: - Names

    func name(for clientInstanceId: String) -> String? {
        names[clientInstanceId]
    }

    /// Records the name a computer announced for itself.
    func remember(name: String, for clientInstanceId: String) {
        guard !name.isEmpty, names[clientInstanceId] != name else { return }
        names[clientInstanceId] = name
        pruneNames(keeping: clientInstanceId)
        persistNames()
    }

    /// Sign-out.
    ///
    /// These name another account's computers, and a client id is not reusable across
    /// accounts — the same reason the in-memory selection is cleared there.
    func forget() {
        clientInstanceId = nil
        names = [:]
        defaults.removeObject(forKey: Self.viewedKey)
        defaults.removeObject(forKey: Self.namesKey)
    }

    private func pruneNames(keeping keep: String) {
        guard names.count > Self.maxRememberedNames else { return }
        // Gathered before removing: the dictionary cannot be mutated while it is
        // being iterated. The computer being viewed is evicted last, so that leaving
        // one and coming back to it does not lose the only name it has.
        let overflow = names.count - Self.maxRememberedNames
        let evictable = names.keys.filter { $0 != keep }.prefix(overflow)
        for key in evictable {
            names.removeValue(forKey: key)
        }
    }

    private func persistNames() {
        guard let encoded = try? JSONEncoder().encode(names) else { return }
        defaults.set(encoded, forKey: Self.namesKey)
    }
}
