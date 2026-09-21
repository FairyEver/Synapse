import Foundation
import Testing

@testable import SynapseMobile

/// A payload as the computer builds it: newest first, times in the wire format.
private func payload(
    _ desktopClientInstanceId: String,
    revision: Int = 1,
    entries: [MobileClipboardEntry]
) -> MobileClipboardPayload {
    MobileClipboardPayload(
        desktopClientInstanceId: desktopClientInstanceId,
        revision: revision,
        entries: entries
    )
}

/// The wire's own timestamp shape, through the same parser the store uses — a test that
/// built these by hand would be the third place that has to know about the milliseconds.
private func stamp(_ offsetSeconds: Int) -> String {
    let base = Date(timeIntervalSince1970: 1_800_000_000)
    return ISO8601DateFormatter.withFractionalSeconds.string(
        from: base.addingTimeInterval(TimeInterval(offsetSeconds))
    )
}

private func entry(_ id: String, _ text: String, at offsetSeconds: Int) -> MobileClipboardEntry {
    MobileClipboardEntry(id: id, text: text, copiedAt: stamp(offsetSeconds))
}

/// Each test gets its own defaults domain: these lists persist, and a shared domain
/// would let one test's rows be another's starting state.
@MainActor
private func makeStore(
    limit: Int = ClipboardHistoryStore.defaultLimit,
    bucketLimit: Int = ClipboardHistoryStore.defaultBucketLimit
) throws -> (ClipboardHistoryStore, UserDefaults) {
    let name = "clipboard-history-tests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defaults.removePersistentDomain(forName: name)
    return (ClipboardHistoryStore(defaults: defaults, limit: limit, bucketLimit: bucketLimit), defaults)
}

@MainActor
struct ClipboardHistoryTests {
    @Test func aSnapshotIsMergedIntoTheLocalListRatherThanReplacingIt() throws {
        // The bug this exists for: the computer keeps twenty entries and this keeps
        // fifty, so a phone that assigned the payload would silently drop thirty rows
        // — the older half, which is exactly the half the computer can no longer send.
        let (store, _) = try makeStore()
        let older = (0..<40).map { entry("old-\($0)", "older \($0)", at: $0) }
        store.merge(payload("desk-1", entries: older))

        let newer = (0..<20).map { entry("new-\($0)", "newer \($0)", at: 100 + $0) }
        store.merge(payload("desk-1", revision: 2, entries: newer))

        let entries = store.entries(for: "desk-1")
        #expect(entries.count == ClipboardHistoryStore.defaultLimit)
        #expect(entries.first?.id == "new-19")
        // The oldest ten of the original forty are gone by the fifty-entry rule, not
        // by the assignment: forty and twenty together are sixty.
        #expect(entries.contains { $0.id == "old-39" })
        #expect(entries.contains { $0.id == "old-10" })
        #expect(!entries.contains { $0.id == "old-9" })
    }

    @Test func theSameTextCopiedAgainMovesUpInsteadOfAppearingTwice() throws {
        let (store, _) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0)]))
        let firstSeen = store.entries(for: "desk-1").first?.copiedAt

        store.merge(payload("desk-1", revision: 2, entries: [entry("b", "beta", at: 10)]))
        store.merge(payload("desk-1", revision: 3, entries: [entry("a", "alpha", at: 20)]))

        let entries = store.entries(for: "desk-1")
        #expect(entries.map(\.id) == ["a", "b"])
        // The time has to move with it, or the row would keep showing when it was first
        // copied rather than when it was copied again.
        #expect(entries.first?.copiedAt != firstSeen)
    }

    @Test func onlyTheNewestFiftyAreKept() throws {
        let (store, _) = try makeStore()
        let many = (0..<60).map { entry("e-\($0)", "text \($0)", at: $0) }

        store.merge(payload("desk-1", entries: many))

        let entries = store.entries(for: "desk-1")
        #expect(entries.count == 50)
        #expect(entries.first?.id == "e-59")
        #expect(entries.last?.id == "e-10")
    }

    @Test func aClearedListIsNotRefilledByTheNextSnapshot() throws {
        // The computer still holds those entries in its own ring and re-sends all of
        // them on the next copy, so without the watermark "clear" would mean "until the
        // next thing you copy anywhere".
        let (store, _) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0), entry("b", "beta", at: 10)]))
        store.clear(for: "desk-1")
        #expect(store.entries(for: "desk-1").isEmpty)

        store.merge(payload("desk-1", revision: 2, entries: [entry("a", "alpha", at: 0), entry("b", "beta", at: 10)]))
        #expect(store.entries(for: "desk-1").isEmpty)

        // Copied again *after* the clear, so it is a new thing and not the old row.
        store.merge(payload("desk-1", revision: 3, entries: [entry("a", "alpha", at: 3_600)]))
        #expect(store.entries(for: "desk-1").map(\.id) == ["a"])
    }

    @Test func clearsOneComputerAndLeavesTheOtherAlone() throws {
        let (store, _) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0)]))
        store.merge(payload("desk-2", entries: [entry("b", "beta", at: 0)]))

        store.clear(for: "desk-1")

        #expect(store.entries(for: "desk-1").isEmpty)
        #expect(store.entries(for: "desk-2").map(\.id) == ["b"])
    }

    @Test func eachComputerKeepsItsOwnList() throws {
        let (store, _) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0)]))
        store.merge(payload("desk-2", entries: [entry("b", "beta", at: 0)]))

        #expect(store.entries(for: "desk-1").map(\.text) == ["alpha"])
        #expect(store.entries(for: "desk-2").map(\.text) == ["beta"])
        // No computer chosen is nothing to show, not everything: the panel is opened
        // from a screen that names one, and another one's text under that name is the
        // thing this store exists to prevent.
        #expect(store.entries(for: nil).isEmpty)
    }

    @Test func theListSurvivesTheAppBeingRestarted() throws {
        let (store, defaults) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0)]))

        let reopened = ClipboardHistoryStore(defaults: defaults)
        #expect(reopened.entries(for: "desk-1").map(\.text) == ["alpha"])
    }

    @Test func aClearedListStaysClearedAcrossARestart() throws {
        let (store, defaults) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0)]))
        store.clear(for: "desk-1")

        let reopened = ClipboardHistoryStore(defaults: defaults)
        reopened.merge(payload("desk-1", revision: 2, entries: [entry("a", "alpha", at: 0)]))
        #expect(reopened.entries(for: "desk-1").isEmpty)
    }

    @Test func aStoreThatWillNotDecodeIsTreatedAsEmpty() throws {
        let (_, defaults) = try makeStore()
        defaults.set(Data("not json at all".utf8), forKey: "SynapseClipboardHistory")

        // Starting over beats refusing to start: this is a cache of something the
        // computer can send again, and the cost of the other choice is the whole screen.
        let store = ClipboardHistoryStore(defaults: defaults)
        #expect(store.entries(for: "desk-1").isEmpty)
    }

    @Test func signingOutForgetsEveryComputer() throws {
        let (store, defaults) = try makeStore()
        store.merge(payload("desk-1", entries: [entry("a", "alpha", at: 0)]))
        store.merge(payload("desk-2", entries: [entry("b", "beta", at: 0)]))

        store.clearAll()

        #expect(store.entries(for: "desk-1").isEmpty)
        #expect(store.entries(for: "desk-2").isEmpty)
        // And on disk: this is the only thing the app persists that belongs to an
        // account rather than to the device, so the next sign-in must not find it.
        let reopened = ClipboardHistoryStore(defaults: defaults)
        #expect(reopened.entries(for: "desk-1").isEmpty)
    }

    @Test func theOldestComputerIsForgottenOnceTooManyHaveBeenSeen() throws {
        // Nothing else bounds this: the key is a computer's install id, so reinstalls
        // and new machines would otherwise accumulate a list each with nothing to
        // remove them.
        let (store, _) = try makeStore(bucketLimit: 3)
        for index in 0..<3 {
            store.merge(payload("desk-\(index)", entries: [entry("e-\(index)", "text", at: index)]))
        }

        // A fourth computer, whose entry is the newest thing seen.
        store.merge(payload("desk-3", entries: [entry("e-3", "text", at: 99)]))

        #expect(store.entries(for: "desk-0").isEmpty)
        #expect(store.entries(for: "desk-1").count == 1)
        #expect(store.entries(for: "desk-3").count == 1)
    }
}
