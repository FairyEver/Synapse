import Foundation
import Observation

/// What one computer's clipboard list holds.
///
/// `clearedKeys` is what a clear leaves behind. Without it, clearing the list would be
/// undone by the next snapshot: the computer still holds those twenty entries in its
/// own ring and re-sends all of them the next time anything is copied, so the rows the
/// reader just deleted would come straight back.
///
/// The rows are remembered by *what they were* — the id together with the moment the
/// computer copied them — rather than by a timestamp the merge compares against. A
/// timestamp would be a comparison between two machines' clocks: a computer whose clock
/// runs behind would have its genuine new copies measured as older than "the moment I
/// cleared" and dropped without a word. This way the re-sent row is recognised as the
/// same row, and the same text copied again is recognised as a new one, with no clock
/// involved on either side.
private struct ClipboardHistoryBucket: Codable, Equatable {
    var entries: [MobileClipboardEntry] = []
    var clearedKeys: Set<String> = []
}

/// The text recently copied on each of the user's computers.
///
/// Two things here are not like the other per-computer state on this screen, and both
/// are load-bearing:
///
/// **It is a bucket per computer, not one slot with an owner.** `TerminalToolbarState`
/// and `TerminalQuickPhrasesState` hold a single value and compare its owner against the
/// computer being viewed, which is why switching computers needs to clear nothing. This
/// one cannot work that way: the reader's list is theirs, it survives being offline, and
/// it is the whole point that switching to a computer shows *that* computer's text
/// rather than nothing until it answers.
///
/// **What arrives is merged, not assigned.** The computer keeps twenty entries and this
/// keeps fifty, so a payload is never the whole truth — assigning it would silently cut
/// the local list down to twenty every time someone copied something. Merging by id is
/// also what makes a repeated copy move an existing row to the top instead of adding a
/// second one, which is the same rule the computer applies on its side.
///
/// It is the first thing on this app that is both persisted and about the account, so
/// `SynapseAppModel.signOut()` has to clear it: the next account to sign in on this
/// phone would otherwise find the previous one's copied text sitting in a panel.
@MainActor
@Observable
final class ClipboardHistoryStore {
    /// How many entries one computer's list keeps.
    ///
    /// `nonisolated` because both of these are default arguments, and a default argument
    /// is evaluated outside the actor: without it, Swift 6 mode would reject them and
    /// Swift 5 warns. They are immutable Sendable values, so there is nothing to isolate.
    nonisolated static let defaultLimit = 50

    /// How many computers' lists are kept.
    ///
    /// Bounded because nothing else bounds it: the key is a computer's install id, so a
    /// user who reinstalls or moves between machines would accumulate a list per id they
    /// have ever signed in from, and nothing would ever remove one. Eight is
    /// `ViewedDesktopPreference`'s own number for remembering computers, and it has the
    /// same problem to solve.
    nonisolated static let defaultBucketLimit = 8

    private var buckets: [String: ClipboardHistoryBucket] {
        didSet {
            guard buckets != oldValue else { return }
            persist()
        }
    }

    private let defaults: UserDefaults
    private let limit: Int
    private let bucketLimit: Int

    private static let storageKey = "SynapseClipboardHistory"

    init(
        defaults: UserDefaults = .standard,
        limit: Int = ClipboardHistoryStore.defaultLimit,
        bucketLimit: Int = ClipboardHistoryStore.defaultBucketLimit
    ) {
        self.defaults = defaults
        self.limit = limit
        self.bucketLimit = bucketLimit

        // A store that will not decode is an empty store rather than an error: it is a
        // cache of something the computer can send again, and refusing to start over it
        // would cost the reader the whole screen.
        self.buckets = defaults.data(forKey: Self.storageKey)
            .flatMap { try? JSONDecoder().decode([String: ClipboardHistoryBucket].self, from: $0) }
            ?? [:]
    }

    /// One computer's list, newest first.
    ///
    /// `nil` — no computer chosen — is an empty list rather than everything: the panel
    /// is opened from a screen that names a computer, and showing another one's text
    /// under that name is the one thing this store exists to prevent.
    func entries(for desktopClientInstanceId: String?) -> [MobileClipboardEntry] {
        guard let desktopClientInstanceId else { return [] }
        return buckets[desktopClientInstanceId]?.entries ?? []
    }

    /// Folds a computer's snapshot into its list.
    ///
    /// The order is what makes the local half survive: everything already held goes in
    /// first, then the payload overwrites by id — so an entry the computer has a newer
    /// copy of wins, and one it has forgotten about is left alone.
    func merge(_ payload: MobileClipboardPayload) {
        let id = payload.desktopClientInstanceId
        var bucket = buckets[id] ?? ClipboardHistoryBucket()

        var byId: [String: MobileClipboardEntry] = [:]
        for entry in bucket.entries { byId[entry.id] = entry }
        for entry in payload.entries {
            // The rows the reader deleted, recognised by what they were. Everything
            // else merges — including the same text copied again, whose moment is new
            // and whose key is therefore not in this set.
            if bucket.clearedKeys.contains(Self.key(id: entry.id, copiedAt: entry.copiedAt)) { continue }
            byId[entry.id] = entry
        }

        bucket.entries = Array(
            byId.values
                .sorted { ($0.copiedAtDate ?? .distantPast) > ($1.copiedAtDate ?? .distantPast) }
                .prefix(limit)
        )
        buckets[id] = bucket
        pruneBuckets(keeping: id)
    }

    /// Empties one computer's list, leaving the computer's own clipboard alone.
    func clear(for desktopClientInstanceId: String) {
        guard var bucket = buckets[desktopClientInstanceId] else { return }
        // Replaced rather than accumulated: what matters is the rows that were on
        // screen when the reader asked, and those are exactly the ones just removed.
        bucket.clearedKeys = Set(bucket.entries.map { Self.key(id: $0.id, copiedAt: $0.copiedAt) })
        bucket.entries = []
        buckets[desktopClientInstanceId] = bucket
    }

    private static func key(id: String, copiedAt: String) -> String {
        "\(id)\u{1F}\(copiedAt)"
    }

    /// Forgets everything, for signing out.
    ///
    /// Not a tidy-up: this data is the user's own copied text, and it is the only thing
    /// this app persists that belongs to an account rather than to a device.
    func clearAll() {
        buckets = [:]
    }

    /// Drops the computers that have gone longest without anything new.
    ///
    /// Keyed on each list's own newest entry rather than on a last-seen stamp, so there
    /// is nothing extra to keep in step. `keeping` is never dropped however old it is:
    /// the reader is looking at that computer right now.
    private func pruneBuckets(keeping current: String) {
        guard buckets.count > bucketLimit else { return }
        let candidates = buckets
            .filter { $0.key != current }
            .sorted { newest($0.value) < newest($1.value) }
        for (id, _) in candidates.prefix(buckets.count - bucketLimit) {
            buckets.removeValue(forKey: id)
        }
    }

    private func newest(_ bucket: ClipboardHistoryBucket) -> Date {
        bucket.entries.compactMap { $0.copiedAtDate }.max() ?? .distantPast
    }

    private func persist() {
        defaults.set(try? JSONEncoder().encode(buckets), forKey: Self.storageKey)
    }
}
