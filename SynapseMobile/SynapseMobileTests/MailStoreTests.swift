import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MailStoreTests {
    @Test func selfSentMailUsesInboxReadStateAndKeepsSentReadState() async {
        let api = MailReviewAPI()
        let store = MailStore()
        var readRequests: [(String, Bool)] = []
        api.messageOperation = { id in mailSelfMessage(id, readAt: nil) }
        api.setReadOperation = { id, read in readRequests.append((id, read)) }
        store.messages = [mailSummary("self", readAt: nil)]
        store.counts = MailCounts(inboxTotal: 1, sentTotal: 1, unread: 1)

        store.box = .inbox
        #expect(await store.open(id: "self", using: api))
        #expect(readRequests.map { $0.1 } == [true])
        #expect(store.detail?.readAt != nil)

        readRequests.removeAll()
        store.box = .sent
        #expect(await store.open(id: "self", using: api))
        #expect(readRequests.isEmpty)
    }

    @Test(arguments: ["unread", "read", "readRetry", "all", "allAfterOther", "other", "failed"])
    func aLateDetailSnapshotKeepsTheReadStateAcknowledgedWhileReopening(followUp: String) async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        let bulkGate = MailReviewGate()
        let readGate = MailReviewGate()
        let initiallyRead = followUp == "unread" || followUp == "other" || followUp == "failed"
        var serverRead = ["mail": initiallyRead, "other": true]
        var readRequests: [(String, Bool)] = []
        var holdNextRead = false
        api.messageOperation = { id in
            mailReviewMessage(id, readAt: serverRead[id] == true ? "2026-10-05T00:00:00Z" : nil)
        }
        // A rejected first automatic acknowledgement leaves a real unread detail to retry.
        api.setReadOperation = { _, _ in throw APIError(status: 400, code: nil, message: "Read state rejected") }
        store.messages = [mailSummary("mail", readAt: initiallyRead ? "2026-10-05T00:00:00Z" : nil), mailSummary("other", readAt: "2026-10-05T00:00:00Z")]
        store.counts = MailCounts(inboxTotal: 2, sentTotal: 0, unread: initiallyRead ? 0 : 1)
        #expect(await store.open(id: "mail", using: api))
        #expect((store.detail?.readAt != nil) == initiallyRead)

        api.setReadOperation = { id, read in
            readRequests.append((id, read))
            if followUp == "failed" { throw URLError(.notConnectedToInternet) }
            serverRead[id] = read
            if holdNextRead {
                holdNextRead = false
                await readGate.hold()
            }
        }
        api.readAllOperation = {
            serverRead["mail"] = true
            serverRead["other"] = true
            if followUp == "allAfterOther" { await bulkGate.hold() }
            return MailBulkReadResult(updated: 2)
        }
        api.messagesPage = { _, _ in
            MailMessagePage(items: ["mail", "other"].map { mailSummary($0, readAt: serverRead[$0] == true ? "2026-10-05T00:00:00Z" : nil) }, nextCursor: nil)
        }
        api.countsOperation = { MailCounts(inboxTotal: 2, sentTotal: 0, unread: serverRead.values.filter { !$0 }.count) }
        if followUp == "other" {
            serverRead["mail"] = false
            await store.load(using: api)
        }
        api.messageOperation = { id in
            let snapshot = mailReviewMessage(id, readAt: serverRead[id] == true ? "2026-10-05T00:00:00Z" : nil, body: "新正文")
            await gate.hold()
            return snapshot
        }
        // Back and reopen the same ID: the cached detail stays usable while this GET waits.
        let reopening = Task { await store.open(id: "mail", using: api) }
        await gate.waitUntilHeld()
        #expect((store.detail?.readAt != nil) == initiallyRead)
        switch followUp {
        case "readRetry":
            holdNextRead = true
            let first = Task { await store.setRead(id: "mail", read: true, using: api) }
            await readGate.waitUntilHeld()
            await store.setRead(id: "mail", read: true, using: api)
            await readGate.release()
            await first.value
        case "allAfterOther":
            let bulk = Task { await store.readAll(using: api) }
            await bulkGate.waitUntilHeld()
            await store.setRead(id: "other", read: false, using: api)
            await bulkGate.release()
            await bulk.value
        case "all": await store.readAll(using: api)
        case "other": await store.setRead(id: "other", read: false, using: api)
        default: await store.setRead(id: "mail", read: followUp == "read", using: api)
        }

        await gate.release()
        #expect(await reopening.value)
        let expectedRead = followUp != "unread"
        #expect(store.detail?.messageId == "mail")
        #expect((store.detail?.readAt != nil) == expectedRead)
        #expect((store.messages.first?.readAt != nil) == expectedRead)
        #expect(serverRead["mail"] == expectedRead)
        #expect(store.detail?.body == "新正文", "Fresh body content remains valid even when its read snapshot is stale")
        let targetReadRequests = readRequests.filter { $0.0 == "mail" }.map { $0.1 }
        let expectedRequests = switch followUp {
        case "unread", "failed": [false]
        case "readRetry": [true, true]
        case "read", "other": [true]
        default: [Bool]()
        }
        #expect(targetReadRequests == expectedRequests)
        #expect(store.counts?.unread == serverRead.values.filter { !$0 }.count)
        #expect((store.error != nil) == (followUp == "failed"))
    }

    @Test func aLateDetailSnapshotCannotReplaceTheNextOpenMessage() async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        #expect(await store.open(id: "mail", using: api))
        api.messageOperation = { id in
            if id == "mail" { await gate.hold() }
            return mailReviewMessage(id, body: "新正文")
        }
        let old = Task { await store.open(id: "mail", using: api) }
        await gate.waitUntilHeld()
        #expect(await store.open(id: "next", using: api))
        await gate.release()
        #expect(await old.value)
        #expect(store.detail?.messageId == "next")
        #expect(store.detail?.body == "新正文")
    }

    @Test(arguments: ["automatic", "all", "other", "failed"])
    func reopeningAMessageKeepsItsNewerReadAcknowledgement(followUp: String) async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        var serverRead = ["mail": true, "other": true]
        var readRequests: [Bool] = []
        api.messageOperation = { id in
            mailReviewMessage(id, readAt: serverRead[id] == true ? "2026-10-05T00:00:00Z" : nil)
        }
        api.setReadOperation = { id, read in
            if read, followUp == "failed" {
                readRequests.append(read)
                throw APIError(status: 400, code: nil, message: "Read state rejected")
            }
            serverRead[id] = read
            readRequests.append(read)
            if id == "mail", !read { await gate.hold() }
        }
        api.readAllOperation = {
            serverRead["mail"] = true
            return MailBulkReadResult(updated: 1)
        }
        api.messagesPage = { _, _ in
            MailMessagePage(items: [mailSummary("mail", readAt: serverRead["mail"] == true ? "2026-10-05T00:00:00Z" : nil)], nextCursor: nil)
        }
        api.countsOperation = {
            MailCounts(inboxTotal: 2, sentTotal: 0, unread: serverRead["mail"] == true ? 0 : 1)
        }
        store.messages = [mailSummary("mail", readAt: "2026-10-05T00:00:00Z")]
        store.counts = MailCounts(inboxTotal: 2, sentTotal: 0, unread: 0)
        #expect(await store.open(id: "mail", using: api))

        // The server committed the menu's unread action; only its response is held.
        let old = Task { await store.setRead(id: "mail", read: false, using: api) }
        await gate.waitUntilHeld()
        #expect(serverRead["mail"] == false)
        let hasNewerRead = followUp == "automatic" || followUp == "all"
        if followUp == "all" { await store.readAll(using: api) }
        else if followUp == "failed" { await store.setRead(id: "mail", read: true, using: api) }
        else { #expect(await store.open(id: hasNewerRead ? "mail" : "other", using: api)) }
        #expect(store.detail?.readAt != nil)
        #expect(readRequests == (followUp == "automatic" || followUp == "failed" ? [false, true] : [false]))
        let currentError = store.error

        await gate.release()
        await old.value
        #expect(store.detail?.messageId == (followUp == "other" ? "other" : "mail"))
        #expect((store.detail?.readAt != nil) == (followUp != "failed"))
        #expect((store.messages.first?.readAt != nil) == hasNewerRead)
        #expect(store.counts?.unread == (hasNewerRead ? 0 : 1))
        #expect(serverRead["mail"] == hasNewerRead)
        #expect(store.error == currentError)
        #expect((store.error != nil) == (followUp == "failed"))
    }

    @Test(arguments: MailFeedbackSequence.allCases)
    func aPendingNewReadOwnsFeedbackBeforeOlderMutationOrRefreshFinishes(sequence: MailFeedbackSequence) async {
        let api = MailReviewAPI()
        let store = MailStore()
        let oldGate = MailReviewGate()
        let newGate = MailReviewGate()
        _ = await store.open(id: "mail", using: api)
        if sequence.failsInRefresh {
            api.messagesPage = { _, _ in await oldGate.hold(); throw URLError(.timedOut) }
        } else {
            api.readAllOperation = { await oldGate.hold(); throw URLError(.timedOut) }
        }
        let old = Task { await store.readAll(using: api) }
        await oldGate.waitUntilHeld()
        api.setReadOperation = { _, _ in
            await newGate.hold()
            if sequence.newReadFails { throw URLError(.notConnectedToInternet) }
        }
        let current = Task { await store.setRead(id: "mail", read: false, using: api) }
        await newGate.waitUntilHeld()
        await oldGate.release()
        await old.value
        #expect(store.error == nil, "The current pending read owns feedback before it has returned")
        await newGate.release()
        await current.value
        #expect((store.error != nil) == sequence.newReadFails)
        if sequence.newReadFails { #expect(store.error == URLError(.notConnectedToInternet).localizedDescription) }
        #expect(store.detail?.messageId == "mail")
        #expect((store.detail?.readAt != nil) == sequence.newReadFails)
    }

    @Test(arguments: ["delete", "readAll", "deleteBatch", "deleteAll"], [false, true])
    func anOldMutationRefreshKeepsTheNewDetailsFailure(operation: String, refreshFails: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        _ = await store.open(id: "removed", using: api)
        api.singleDeleteOperation = { _ in await gate.hold() }
        api.readAllOperation = { await gate.hold(); return MailBulkReadResult(updated: 1) }
        api.deleteOperation = { _, _ in await gate.hold(); return MailBulkDeleteResult(deleted: 1, skippedIds: []) }
        let old = Task {
            switch operation {
            case "delete": return await store.delete(id: "removed", using: api)
            case "deleteBatch": return await store.deleteBatch(ids: ["removed"], using: api)
            case "deleteAll": return await store.deleteAll(box: "inbox", using: api)
            default: await store.readAll(using: api); return true
            }
        }
        await gate.waitUntilHeld()
        _ = await store.open(id: "new-detail", using: api)
        store.context = [mailSummary("related")]
        api.setReadOperation = { _, _ in throw URLError(.notConnectedToInternet) }
        await store.setRead(id: "new-detail", read: false, using: api)
        let currentError = store.error
        #expect(currentError != nil)
        api.messagesPage = { _, _ in
            if refreshFails { throw URLError(.timedOut) }
            return MailMessagePage(items: [mailSummary("new-detail", readAt: "2026-10-05T00:00:00Z")], nextCursor: nil)
        }
        api.countsOperation = { MailCounts(inboxTotal: 1, sentTotal: 0, unread: 0) }
        await gate.release()
        #expect(await old.value)
        #expect(store.error == currentError)
        #expect(store.detail?.messageId == "new-detail")
        #expect(store.detail?.readAt != nil)
        #expect(store.context.map(\.messageId) == ["related"])
        #expect(api.messagesCalls == 1, "Committed mutations must still refresh the list")
        if !refreshFails {
            #expect(store.messages.map(\.messageId) == ["new-detail"])
            #expect(store.counts?.unread == 0)
        }
    }

    @Test(arguments: [false, true])
    func aLateDetailActionFailureCannotAppearOnTheNextMessage(deleting: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        _ = await store.open(id: "old-detail", using: api)
        api.singleDeleteOperation = { _ in await gate.hold(); throw URLError(.timedOut) }
        api.setReadOperation = { _, _ in await gate.hold(); throw URLError(.timedOut) }
        let old = Task {
            if deleting { _ = await store.delete(id: "old-detail", using: api) }
            else { await store.setRead(id: "old-detail", read: false, using: api) }
        }
        await gate.waitUntilHeld()
        _ = await store.open(id: "new-detail", using: api)
        #expect(store.error == nil)
        await gate.release()
        await old.value
        #expect(store.error == nil)
        #expect(store.detail?.messageId == "new-detail")
        #expect(store.detail?.readAt != nil)
    }

    @Test func anOldAutomaticReadFailureCannotReplaceTheSuccessfulManualRetry() async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        api.messageOperation = { id in mailReviewMessage(id, readAt: nil) }
        api.setReadOperation = { _, _ in await gate.hold(); throw URLError(.timedOut) }
        let old = Task { await store.open(id: "mail", using: api) }
        await gate.waitUntilHeld()
        #expect(store.detail?.readAt == nil)
        api.setReadOperation = nil
        await store.setRead(id: "mail", read: true, using: api)
        #expect(store.detail?.readAt != nil)
        await gate.release()
        #expect(await old.value)
        #expect(store.error == nil)
        #expect(store.detail?.messageId == "mail")
        #expect(store.detail?.readAt != nil)
    }

    @Test func aSuccessfulReadStateRetryClearsTheFailureAndUpdatesItsOpenDetail() async {
        let api = MailReviewAPI()
        let store = MailStore()
        store.detail = mailReviewMessage("mail")
        store.counts = MailCounts(inboxTotal: 1, sentTotal: 0, unread: 0)
        api.setReadOperation = { _, _ in throw URLError(.notConnectedToInternet) }
        await store.setRead(id: "mail", read: false, using: api)
        #expect(store.error != nil)
        #expect(store.detail?.readAt != nil)
        #expect(store.counts?.unread == 0)

        api.setReadOperation = nil
        await store.setRead(id: "mail", read: false, using: api)
        #expect(store.error == nil)
        #expect(store.detail?.messageId == "mail")
        #expect(store.detail?.readAt == nil)
        #expect(store.counts?.unread == 1)
    }

    @Test(arguments: [false, true]) func aLateReadResultCannotReplaceTheNewerActionsFeedback(oldFails: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        let gate = MailReviewGate()
        store.detail = mailReviewMessage("mail")
        api.setReadOperation = { _, _ in
            await gate.hold()
            if oldFails { throw URLError(.notConnectedToInternet) }
        }
        let old = Task { await store.setRead(id: "mail", read: false, using: api) }
        await gate.waitUntilHeld()
        api.setReadOperation = oldFails ? nil : { _, _ in throw URLError(.notConnectedToInternet) }
        await store.setRead(id: "mail", read: true, using: api)
        let newerFailure = store.error
        #expect((newerFailure == nil) == oldFails)
        await gate.release()
        await old.value
        #expect(store.error == newerFailure)
    }

    @Test func openingUnreadMailRemovesItFromTheUnreadList() async {
        let api = MailReviewAPI()
        let store = MailStore()
        store.unreadOnly = true
        store.messages = [mailSummary("first"), mailSummary("second")]

        await store.setRead(id: "first", read: true, using: api)

        #expect(store.messages.map(\.messageId) == ["second"])
    }

    @Test func aLateUnreadSnapshotCannotResurrectAMessageJustMarkedRead() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        store.unreadOnly = true
        store.messages = [mailSummary("read-now")]
        api.messagesPage = { _, _ in
            if api.messagesCalls == 1 {
                await gate.hold()
                return MailMessagePage(items: [mailSummary("read-now")], nextCursor: nil)
            }
            return MailMessagePage(items: [mailSummary("still-unread")], nextCursor: nil)
        }
        let old = Task { await store.load(using: api) }
        await gate.waitUntilHeld()
        await store.setRead(id: "read-now", read: true, using: api)
        await gate.release()
        await old.value
        #expect(store.messages.map(\.messageId) == ["still-unread"])
        #expect(api.messagesCalls == 2)
    }

    @Test func unreadPaginationRetriesTheSameCursorAfterAReadAcknowledgement() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        store.unreadOnly = true
        store.messages = [mailSummary("first")]
        store.nextCursor = "older"
        api.messagesPage = { _, cursor in
            #expect(cursor == "older")
            if api.messagesCalls == 1 {
                await gate.hold()
                return MailMessagePage(items: [mailSummary("read-now")], nextCursor: nil)
            }
            return MailMessagePage(items: [mailSummary("still-unread")], nextCursor: nil)
        }
        let old = Task { await store.loadMore(using: api) }
        await gate.waitUntilHeld()
        await store.setRead(id: "read-now", read: true, using: api)
        await gate.release()
        await old.value
        #expect(store.messages.map(\.messageId) == ["first", "still-unread"])
        #expect(api.messagesCalls == 2)
    }

    @Test func markingReadInAllMailPreservesTheRow() async {
        let store = MailStore()
        store.messages = [mailSummary("first")]
        await store.setRead(id: "first", read: true, using: MailReviewAPI())
        #expect(store.messages.map(\.messageId) == ["first"])
        #expect(store.messages.first?.readAt != nil)
    }

    @Test func markingAllReadKeepsTheOpenDetailAndItsReadActionConsistent() async {
        let api = MailReviewAPI()
        let store = MailStore()
        store.detail = mailReviewMessage("still-open")
        store.context = [mailSummary("related")]
        await store.setRead(id: "still-open", read: false, using: api)
        #expect(store.detail?.readAt == nil)
        api.messagesPage = { _, _ in MailMessagePage(items: [mailSummary("still-open", readAt: "2026-10-05T00:00:00Z")], nextCursor: nil) }

        await store.readAll(using: api)

        #expect(store.detail?.messageId == "still-open")
        #expect(store.detail?.readAt != nil)
        #expect(store.context.map(\.messageId) == ["related"])
        #expect(store.messages.first?.readAt != nil)
        #expect(store.counts?.unread == 0)
    }

    @Test func aLateReadAllResultDoesNotUndoANewerUnreadAction() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        store.detail = mailReviewMessage("still-open")
        api.readAllOperation = { await gate.hold(); return MailBulkReadResult(updated: 1) }
        api.countsOperation = { MailCounts(inboxTotal: 1, sentTotal: 0, unread: 1) }
        let old = Task { await store.readAll(using: api) }
        await gate.waitUntilHeld()
        await store.setRead(id: "still-open", read: false, using: api)
        await gate.release()
        await old.value

        #expect(store.detail?.messageId == "still-open")
        #expect(store.detail?.readAt == nil)
        #expect(store.counts?.unread == 1)
    }

    @Test func repeatedContextPaginationDoesNotDuplicateAPage() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        store.detail = mailReviewMessage("latest")
        store.context = [mailSummary("latest")]
        store.nextContextCursor = "older"
        api.contextPage = { _, _ in
            await gate.hold()
            return MailMessagePage(items: [mailSummary("old"), mailSummary("latest")], nextCursor: nil)
        }

        let first = Task { await store.loadMoreContext(id: "latest", using: api) }
        await gate.waitUntilHeld()
        await store.loadMoreContext(id: "latest", using: api)
        #expect(api.contextCalls == 1)
        await gate.release()
        await first.value

        #expect(store.context.map(\.messageId) == ["old", "latest"])
        #expect(!store.loadingContext)
    }

    @Test func reopeningTheSameMessageRejectsAnOlderContextPage() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        store.detail = mailReviewMessage("latest")
        store.nextContextCursor = "old-cursor"
        api.contextPage = { _, cursor in
            if cursor != nil {
                await gate.hold()
                return MailMessagePage(items: [mailSummary("stale")], nextCursor: "stale-cursor")
            }
            return MailMessagePage(items: [mailSummary("fresh")], nextCursor: "fresh-cursor")
        }

        let earlier = Task { await store.loadMoreContext(id: "latest", using: api) }
        await gate.waitUntilHeld()
        _ = await store.open(id: "latest", using: api)
        await gate.release()
        await earlier.value

        #expect(store.context.map(\.messageId) == ["fresh"])
        #expect(store.nextContextCursor == "fresh-cursor")
    }

    @Test func deletingAnotherMessageDoesNotClearTheOpenMessage() async {
        let api = MailReviewAPI()
        let store = MailStore()
        store.detail = mailReviewMessage("still-reading")
        #expect(await store.delete(id: "removed", using: api))
        #expect(store.detail?.messageId == "still-reading")
    }

    @Test(arguments: [false, true]) func aLateBulkDeletionPreservesANewerOpenMessage(deleteAll: Bool) async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        _ = await store.open(id: "removed", using: api)
        api.deleteOperation = { _, _ in
            await gate.hold()
            return MailBulkDeleteResult(deleted: 1, skippedIds: [])
        }
        let deletion = Task {
            if deleteAll { return await store.deleteAll(box: "inbox", using: api) }
            return await store.deleteBatch(ids: ["removed"], using: api)
        }
        await gate.waitUntilHeld()
        _ = await store.open(id: "still-reading", using: api)
        store.context = [mailSummary("related")]
        store.nextContextCursor = "more"
        await gate.release()

        #expect(await deletion.value)
        #expect(store.detail?.messageId == "still-reading")
        #expect(store.context.map(\.messageId) == ["related"])
        #expect(store.nextContextCursor == "more")
    }

    @Test(arguments: [false, true]) func bulkDeletionClearsOnlyItsUnchangedDeletedDetail(deleteAll: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        _ = await store.open(id: "removed", using: api)
        store.context = [mailSummary("related")]
        store.nextContextCursor = "more"
        let success = if deleteAll {
            await store.deleteAll(box: "inbox", using: api)
        } else {
            await store.deleteBatch(ids: ["removed"], using: api)
        }

        #expect(success)
        #expect(store.detail == nil)
        #expect(store.context.isEmpty)
        #expect(store.nextContextCursor == nil)
    }

    @Test(arguments: [false, true]) func skippedBulkDeletionPreservesTheOpenDetail(deleteAll: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        _ = await store.open(id: "skipped", using: api)
        api.deleteOperation = { _, _ in MailBulkDeleteResult(deleted: 0, skippedIds: ["skipped"]) }
        if deleteAll { _ = await store.deleteAll(box: "inbox", using: api) }
        else { _ = await store.deleteBatch(ids: ["skipped"], using: api) }

        #expect(store.detail?.messageId == "skipped")
    }

    @Test(arguments: [false, true]) func readAcknowledgementsUpdateUnreadCountsWithoutDoubleCounting(detailOnly: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        store.counts = MailCounts(inboxTotal: 5, sentTotal: 7, unread: 0)
        if detailOnly { store.detail = mailReviewMessage("first") }
        else { store.messages = [mailSummary("first", readAt: "2026-10-04T08:00:00Z")] }

        await store.setRead(id: "first", read: false, using: api)
        #expect(store.counts?.unread == 1)
        await store.setRead(id: "first", read: false, using: api)
        #expect(store.counts?.unread == 1)
        await store.setRead(id: "first", read: true, using: api)
        #expect(store.counts?.unread == 0)
        #expect(store.counts?.inboxTotal == 5)
        #expect(store.counts?.sentTotal == 7)
    }

    @Test func aLateCountSnapshotCannotUndoAReadAcknowledgement() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailStore()
        store.detail = mailReviewMessage("first")
        store.counts = MailCounts(inboxTotal: 5, sentTotal: 7, unread: 0)
        api.countsOperation = {
            if api.countsCalls == 1 {
                await gate.hold()
                return MailCounts(inboxTotal: 5, sentTotal: 7, unread: 0)
            }
            return MailCounts(inboxTotal: 5, sentTotal: 7, unread: 1)
        }
        let load = Task { await store.load(using: api) }
        await gate.waitUntilHeld()
        await store.setRead(id: "first", read: false, using: api)
        await gate.release()
        await load.value

        #expect(store.counts?.unread == 1)
        #expect(api.countsCalls == 2)
    }

    @Test(arguments: [false, true]) func switchingAccountsStopsLaterBulkDeleteChunks(failure: Bool) async {
        let api = MailReviewAPI()
        let store = MailStore()
        store.detail = mailReviewMessage("still-reading")
        var requests = 0
        api.deleteOperation = { ids, _ in
            requests += 1
            await Task.yield()
            api.accountIdentityGeneration += 1
            if failure { throw URLError(.userAuthenticationRequired) }
            return MailBulkDeleteResult(deleted: ids.count, skippedIds: [])
        }
        #expect(!(await store.deleteBatch(ids: (0..<101).map(String.init), using: api)))
        #expect(requests == 1)
        #expect(api.messagesCalls == 0)
        #expect(store.detail?.messageId == "still-reading")
        #expect(store.error == nil)
    }

    @Test func organizationMembersIgnoreAnOlderOrganizationsResponse() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailOrganizationMemberStore()
        api.membersPage = { id, _ in
            if id == "old-org" { await gate.hold() }
            return MailOrganizationMemberPage(items: [mailPerson(id)], nextCursor: nil)
        }

        let old = Task { await store.load(id: "old-org", using: api) }
        await gate.waitUntilHeld()
        await store.load(id: "new-org", using: api)
        await gate.release()
        await old.value

        #expect(store.organizationId == "new-org")
        #expect(store.members.map(\.userId) == ["new-org"])
        #expect(!store.loading)
    }

    @Test func organizationMemberPaginationIsNotRequestedTwice() async {
        let api = MailReviewAPI()
        let gate = MailReviewGate()
        let store = MailOrganizationMemberStore()
        api.membersPage = { _, cursor in
            if cursor == nil { return MailOrganizationMemberPage(items: [mailPerson("first")], nextCursor: "more") }
            await gate.hold()
            return MailOrganizationMemberPage(items: [mailPerson("first"), mailPerson("second")], nextCursor: nil)
        }
        await store.load(id: "org", using: api)
        let first = Task { await store.load(id: "org", cursor: "more", using: api) }
        await gate.waitUntilHeld()
        await store.load(id: "org", cursor: "more", using: api)
        #expect(api.membersCalls == 2)
        await gate.release()
        await first.value
        #expect(store.members.map(\.userId) == ["first", "second"])
    }
}

enum MailFeedbackSequence: CaseIterable, Equatable {
    case parentFailureThenSuccess, parentFailureThenFailure
    case refreshFailureThenSuccess, refreshFailureThenFailure

    var failsInRefresh: Bool {
        self == .refreshFailureThenSuccess || self == .refreshFailureThenFailure
    }
    var newReadFails: Bool {
        self == .parentFailureThenFailure || self == .refreshFailureThenFailure
    }
}

private func mailPerson(_ id: String) -> MailPerson {
    MailPerson(userId: id, nickname: id, handle: nil)
}

private func mailSummary(_ id: String, readAt: String? = nil) -> MailSummary {
    MailSummary(messageId: id, kind: "user", sender: mailPerson("sender"), recipients: [], toRecipients: [], ccRecipients: [], toAddresses: nil, ccAddresses: nil, relationKind: nil, subject: id, snippet: "正文", sentAt: "2026-10-04T08:00:00Z", readAt: readAt, attachmentCount: 0)
}

private func mailReviewMessage(_ id: String, readAt: String? = "2026-10-04T08:00:00Z", body: String = "正文") -> MailMessage {
    MailMessage(messageId: id, kind: "user", viewerId: "reader", sender: mailPerson("sender"), recipients: [], toRecipients: [], ccRecipients: [], toAddresses: nil, ccAddresses: nil, relationKind: nil, subject: id, body: body, sentAt: "2026-10-04T08:00:00Z", readAt: readAt, replyToId: nil, conversationId: id, relation: nil, quote: nil, attachments: [])
}

private func mailSelfMessage(_ id: String, readAt: String?) -> MailMessage {
    let person = mailPerson("reader")
    return MailMessage(messageId: id, kind: "user", viewerId: "reader", sender: person, recipients: [person], toRecipients: [person], ccRecipients: [], toAddresses: nil, ccAddresses: nil, relationKind: nil, subject: id, body: "正文", sentAt: "2026-10-04T08:00:00Z", readAt: readAt, replyToId: nil, conversationId: id, relation: nil, quote: nil, attachments: [])
}

@MainActor
private final class MailReviewAPI: MailStoreAPI, MailOrganizationMemberAPI {
    var accountIdentityGeneration = 0
    func isCurrentAccount(_ generation: Int) -> Bool { generation == accountIdentityGeneration }
    var messagesCalls = 0
    var messagesPage: ((String, String?) async throws -> MailMessagePage)?
    var contextCalls = 0
    var membersCalls = 0
    var contextPage: ((String, String?) async throws -> MailMessagePage)?
    var membersPage: ((String, String?) async throws -> MailOrganizationMemberPage)?
    var countsCalls = 0
    var countsOperation: (() async throws -> MailCounts)?
    var readAllOperation: (() async throws -> MailBulkReadResult)?
    var deleteOperation: (([String], String?) async throws -> MailBulkDeleteResult)?
    var setReadOperation: ((String, Bool) async throws -> Void)?
    var singleDeleteOperation: ((String) async throws -> Void)?
    var messageOperation: ((String) async throws -> MailMessage)?

    func mailContext(id: String, cursor: String?) async throws -> MailMessagePage {
        contextCalls += 1
        return try await contextPage?(id, cursor) ?? MailMessagePage(items: [], nextCursor: nil)
    }
    func mailOrganizationMembers(id: String, cursor: String?) async throws -> MailOrganizationMemberPage {
        membersCalls += 1
        return try await membersPage?(id, cursor) ?? MailOrganizationMemberPage(items: [], nextCursor: nil)
    }
    func mailMessages(box: String, query: String, cursor: String?, unreadOnly: Bool) async throws -> MailMessagePage {
        messagesCalls += 1
        return try await messagesPage?(box, cursor) ?? MailMessagePage(items: [], nextCursor: nil)
    }
    func mailCounts() async throws -> MailCounts {
        countsCalls += 1
        return try await countsOperation?() ?? MailCounts(inboxTotal: 0, sentTotal: 0, unread: 0)
    }
    func mailMessage(id: String) async throws -> MailMessage { try await messageOperation?(id) ?? mailReviewMessage(id) }
    func mailSetRead(id: String, read: Bool) async throws { try await setReadOperation?(id, read) }
    func mailDelete(id: String, box: String?) async throws { try await singleDeleteOperation?(id) }
    func mailReadAll() async throws -> MailBulkReadResult { try await readAllOperation?() ?? MailBulkReadResult(updated: 0) }
    func mailDeleteBatch(ids: [String], box: String?) async throws -> MailBulkDeleteResult {
        try await deleteOperation?(ids, nil) ?? MailBulkDeleteResult(deleted: ids.count, skippedIds: [])
    }
    func mailDeleteAll(box: String) async throws -> MailBulkDeleteResult {
        try await deleteOperation?([], box) ?? MailBulkDeleteResult(deleted: 0, skippedIds: [])
    }
}

private actor MailReviewGate {
    private var held = false
    private var released = false
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []

    func hold() async {
        held = true
        heldWaiters.forEach { $0.resume() }
        heldWaiters.removeAll()
        guard !released else { return }
        await withCheckedContinuation { releaseWaiters.append($0) }
    }
    func waitUntilHeld() async {
        guard !held else { return }
        await withCheckedContinuation { heldWaiters.append($0) }
    }
    func release() {
        released = true
        releaseWaiters.forEach { $0.resume() }
        releaseWaiters.removeAll()
    }
}
