import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MailRecipientRestorationTests {
    @Test func restoresEachRecipientOnceAndPreservesToAndCcRoles() async throws {
        let api = RecipientRestorationReviewAPI()
        let result = try #require(await MailRecipientRestoration.restore(
            toIds: ["a", "a"], ccIds: ["a", "b"], using: api
        ))
        #expect(api.calls == ["a", "b"])
        #expect(result.to.map(\.userId) == ["a"])
        #expect(result.cc.map(\.userId) == ["b"])
        #expect(result.unresolvedTo.isEmpty && result.unresolvedCc.isEmpty)
    }

    @Test func failuresAndNearbyMatchesKeepTheirOriginalUnresolvedIds() async throws {
        let api = RecipientRestorationReviewAPI()
        api.lookup = { id in
            if id == "failed" { throw URLError(.notConnectedToInternet) }
            return MailRecipientPage(items: [recipient("other")], nextCursor: nil)
        }
        let result = try #require(await MailRecipientRestoration.restore(
            toIds: ["failed"], ccIds: ["missing"], using: api
        ))
        #expect(result.to.isEmpty && result.cc.isEmpty)
        #expect(result.unresolvedTo == ["failed"])
        #expect(result.unresolvedCc == ["missing"])
        #expect(result.error != nil)
    }

    @Test func cancellationStopsFurtherLookupsAndRejectsThePartialResult() async {
        let api = RecipientRestorationReviewAPI()
        let gate = RecipientRestorationReviewGate()
        api.lookup = { id in
            await gate.hold()
            return MailRecipientPage(items: [recipient(id)], nextCursor: nil)
        }
        let task = Task { await MailRecipientRestoration.restore(toIds: ["a", "b"], ccIds: [], using: api) }
        await gate.waitUntilHeld()
        task.cancel()
        await gate.release()
        #expect(await task.value == nil)
        #expect(api.calls == ["a"])
    }
}

private func recipient(_ id: String) -> MailRecipientCandidate {
    MailRecipientCandidate(userId: id, nickname: id, handle: nil, matchKind: "exact", similarity: 1, sharedTeamIds: [])
}

@MainActor
private final class RecipientRestorationReviewAPI: MailRecipientRestorationAPI {
    var calls: [String] = []
    var lookup: ((String) async throws -> MailRecipientPage)?
    func mailRecipients(query: String, cursor: String?) async throws -> MailRecipientPage {
        calls.append(query)
        return try await lookup?(query) ?? MailRecipientPage(items: [recipient(query)], nextCursor: nil)
    }
}

private actor RecipientRestorationReviewGate {
    private var held = false
    private var released = false
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
    func hold() async {
        held = true
        heldWaiters.forEach { $0.resume() }
        heldWaiters.removeAll()
        if !released { await withCheckedContinuation { releaseWaiters.append($0) } }
    }
    func waitUntilHeld() async {
        if !held { await withCheckedContinuation { heldWaiters.append($0) } }
    }
    func release() {
        released = true
        releaseWaiters.forEach { $0.resume() }
        releaseWaiters.removeAll()
    }
}
