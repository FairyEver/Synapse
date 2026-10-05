import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalAttachmentSubmissionTests {
    private func context(account: Int = 1, desktop: String = "desktop", viewing: Int = 1) -> TerminalActionContext {
        TerminalActionContext(desktopId: desktop, accountGeneration: account, viewingGeneration: viewing)
    }

    private func attachment(_ id: String) -> TerminalAttachment {
        TerminalAttachment(id: id, name: id + ".txt", sessionId: "session",
            desktopClientInstanceId: "desktop", intentId: id, driveItemId: nil, state: .delivered(path: id + ".txt"))
    }

    @Test func acknowledgementCommitsOnlyFilesCapturedBeforeTheWrite() async {
        let owner = context()
        var files = [attachment("original")]
        let captured = committedAttachmentIds(files, sessionId: "session")
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        let task = Task {
            await TerminalAttachmentSubmission.perform(context: owner, attachmentIds: captured,
                currentContext: { owner }, send: {
                    await withCheckedContinuation { reply = $0 }
                }, commit: { ids in
                    let committed = committedAttachmentIds(files, sessionId: "session", attachmentIds: ids)
                    files.removeAll { committed.contains($0.id) }
                }, fail: { _ in Issue.record("Accepted write failed") })
        }
        while reply == nil { await Task.yield() }
        #expect(files.map(\.id) == ["original"])
        files.append(attachment("later"))
        reply?.resume(returning: .sent)
        await task.value
        #expect(files.map(\.id) == ["later"])
        #expect(files.first?.availableActions.contains(.undoInsert) == true)
    }

    @Test(arguments: [false, true])
    func refusedOrUncertainWriteKeepsUndoAndReportsItsFailure(uncertain: Bool) async {
        let owner = context()
        let files = [attachment("keep")]
        var commits = 0
        var failures: [String] = []
        await TerminalAttachmentSubmission.perform(context: owner,
            attachmentIds: committedAttachmentIds(files, sessionId: "session"), currentContext: { owner },
            send: { uncertain ? .uncertain("未确认") : .notSent("租约未取得") },
            commit: { _ in commits += 1 }, fail: { failures.append($0) })
        #expect(commits == 0)
        #expect(files.first?.availableActions.contains(.undoInsert) == true)
        #expect(failures == [uncertain ? "未确认" : "租约未取得"])
    }

    @Test(arguments: [0, 1, 2, 3])
    func oldWriteCannotCommitOrPublishIntoAnotherContext(change: Int) async {
        let owner = context()
        var current: TerminalActionContext? = owner
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        var commits = 0
        var failures = 0
        let task = Task {
            await TerminalAttachmentSubmission.perform(context: owner, attachmentIds: ["old"],
                currentContext: { current }, send: {
                    await withCheckedContinuation { reply = $0 }
                }, commit: { _ in commits += 1 }, fail: { _ in failures += 1 })
        }
        while reply == nil { await Task.yield() }
        switch change {
        case 0: current = nil
        case 1: current = context(account: 2)
        case 2: current = context(desktop: "other", viewing: 2)
        default: current = context(viewing: 3)
        }
        reply?.resume(returning: change == 0 ? .notSent("旧拒绝") : .sent)
        await task.value
        #expect(commits == 0)
        #expect(failures == 0)
    }

    @Test func changedContextBeforeStartingDoesNotSend() async {
        let owner = context()
        var sends = 0
        await TerminalAttachmentSubmission.perform(context: owner, attachmentIds: ["old"],
            currentContext: { nil }, send: { sends += 1; return .sent },
            commit: { _ in Issue.record("Old write committed") }, fail: { _ in Issue.record("Old failure published") })
        #expect(sends == 0)
    }
}

@MainActor
struct TerminalAttachmentUndoTests {
    private let owner = TerminalActionContext(desktopId: "desktop", accountGeneration: 1, viewingGeneration: 1)

    private func attachment(_ id: String = "original") -> TerminalAttachment {
        TerminalAttachment(id: id, name: id + ".txt", sessionId: "session",
            desktopClientInstanceId: "desktop", intentId: id, driveItemId: nil,
            state: .delivered(path: String(repeating: "a", count: 130)))
    }

    @Test func chunksWaitForAcceptanceAndRemoveOnlyTheOriginalFile() async {
        var files = [attachment()]
        files[0].pathUndo = .pending
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        var chunks: [Int] = []
        let task = Task {
            await TerminalAttachmentUndo.perform(characterCount: 130, context: owner,
                currentContext: { owner }, isPending: { files.contains { $0.id == "original" && $0.pathUndo == .pending } },
                send: { count in
                    chunks.append(count)
                    if chunks.count == 1 { return await withCheckedContinuation { reply = $0 } }
                    return .sent
                }, finish: { result in
                    #expect(result == .sent)
                    files.removeAll { $0.id == "original" }
                })
        }
        while reply == nil { await Task.yield() }
        #expect(chunks == [64])
        #expect(files.count == 1)
        #expect(files[0].availableActions.isEmpty)
        #expect(!files[0].canBeDismissed)
        files.append(attachment("later"))
        reply?.resume(returning: .sent)
        await task.value
        #expect(chunks == [64, 64, 2])
        #expect(files.map(\.id) == ["later"])
        #expect(files[0].availableActions.contains(.undoInsert))
    }

    @Test(arguments: ["电脑离线，命令没有发送。", "电脑正在使用这个会话，命令没有发送。"])
    func aKnownRefusalBeforeAnyBackspaceKeepsTheUndo(message: String) async {
        var file = attachment()
        file.pathUndo = .pending
        var attempts = 0
        var reported: String?
        await TerminalAttachmentUndo.perform(characterCount: 130, context: owner,
            currentContext: { owner }, isPending: { file.pathUndo == .pending },
            send: { _ in attempts += 1; return .notSent(message) }, finish: { result in
                guard case .notSent(let reason) = result else { Issue.record("A refused undo was completed"); return }
                file.pathUndo = nil
                reported = reason
            })
        #expect(attempts == 1)
        #expect(reported == message)
        #expect(file.state.isDelivered)
        #expect(file.availableActions == [.undoInsert, .dismiss])
    }

    @Test(arguments: [false, true])
    func partialAcceptanceOrUncertaintyCannotRepeatTheFullUndo(uncertain: Bool) async {
        var file = attachment()
        file.pathUndo = .pending
        var chunks: [Int] = []
        await TerminalAttachmentUndo.perform(characterCount: 130, context: owner,
            currentContext: { owner }, isPending: { file.pathUndo == .pending },
            send: { count in
                chunks.append(count)
                if uncertain { return .uncertain("回执丢失") }
                return chunks.count == 1 ? .sent : .notSent("租约拒绝")
            }, finish: { result in
                guard case .blocked(let reason) = result else { Issue.record("Unsafe full-path retry was allowed"); return }
                file.pathUndo = .blocked(reason)
            })
        #expect(chunks == (uncertain ? [64] : [64, 64]))
        #expect(file.state.isDelivered)
        #expect(file.insertedPath?.count == 130)
        #expect(file.availableActions == [.dismiss])
        #expect(file.stateDescription == (uncertain ? TerminalAttachmentUndo.interruptedMessage : TerminalAttachmentUndo.partialMessage))
    }

    @Test(arguments: [0, 1, 2])
    func changedOwnershipOrRemovedAttachmentStopsFurtherBackspaces(change: Int) async {
        var context: TerminalActionContext? = owner
        var pending = true
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        var sends = 0
        var finishes = 0
        let task = Task {
            await TerminalAttachmentUndo.perform(characterCount: 130, context: owner,
                currentContext: { context }, isPending: { pending }, send: { _ in
                    sends += 1
                    return await withCheckedContinuation { reply = $0 }
                }, finish: { _ in finishes += 1 })
        }
        while reply == nil { await Task.yield() }
        switch change {
        case 0: context = TerminalActionContext(desktopId: "desktop", accountGeneration: 2, viewingGeneration: 1)
        case 1: context = TerminalActionContext(desktopId: "other", accountGeneration: 1, viewingGeneration: 2)
        default: pending = false
        }
        reply?.resume(returning: .sent)
        await task.value
        #expect(sends == 1)
        #expect(finishes == 0)
    }
}

struct TerminalAttachmentDeliveryTests {
    @Test(arguments: [
        "文件已落到电脑，但这个终端已经不在了，路径没有插入。",
        "文件已落到电脑，但桌面端正在使用这个终端，路径没有插入。",
        "文件已落到电脑，但路径没有插入。",
    ])
    func acceptedFileWithoutInsertionDoesNotOfferBackspaces(caveat: String) throws {
        var file = attachment()
        file.acceptDelivery(try result(message: caveat))
        #expect(file.state == .delivered(path: "/tmp/landed.txt"))
        #expect(file.name == "landed.txt")
        #expect(file.state.isDelivered)
        #expect(file.insertedPath == nil)
        #expect(file.availableActions == [.dismiss])
        #expect(file.stateDescription == "已送达")
    }

    @Test(arguments: [Optional<String>.none, "其它说明；并非路径没有插入的结果。"])
    func insertedAndLegacyResultsKeepTheirActualUndo(message: String?) throws {
        var file = attachment()
        file.acceptDelivery(try result(message: message))
        #expect(file.insertedPath == "/tmp/landed.txt")
        #expect(file.availableActions == [.undoInsert, .dismiss])
        #expect(file.stateDescription == "已插入")
    }

    private func attachment() -> TerminalAttachment {
        TerminalAttachment(id: "original", name: "picked.txt", sessionId: "session",
            desktopClientInstanceId: "desktop", intentId: "intent", driveItemId: "cloud", state: .receiving(nil))
    }

    private func result(message: String?) throws -> MobileIntentResult {
        var payload: [String: Any] = ["intentId": "intent", "outcome": "accepted", "sessionId": "session", "landedPath": "/tmp/landed.txt"]
        if let message { payload["message"] = message }
        return try JSONDecoder().decode(MobileIntentResult.self, from: JSONSerialization.data(withJSONObject: payload))
    }
}

/// Turning a name the user picked into one the computer can write and the terminal
/// can be given.
///
/// This is a security boundary rather than a tidy-up. The path is typed into a
/// shell **unquoted** — that is the feature, not an oversight — so anything left in
/// the name that a shell would read as more than a path is a way for a file the
/// user picked to run something. The cases below are the desktop's own table, kept
/// in step deliberately: the two sanitizers have to agree, or the name shown while
/// a file is in flight is not the name it gets.
struct TerminalFileNameTests {
    @Test func ordinaryNamesSurvive() {
        #expect(sanitizedFileName("报错截图.png") == "报错截图.png")
        #expect(sanitizedFileName("IMG_4821.jpg") == "IMG_4821.jpg")
        #expect(sanitizedFileName("server.log") == "server.log")
        #expect(sanitizedFileName("my-report_v2.txt") == "my-report_v2.txt")
    }

    @Test func aNameIsNeverAPath() {
        #expect(sanitizedFileName("../../etc/passwd") == "passwd")
        #expect(sanitizedFileName("/etc/passwd") == "passwd")
        #expect(sanitizedFileName("..\\..\\Windows\\system32\\evil.dll") == "evil.dll")
        #expect(sanitizedFileName("a/b/c.png") == "c.png")

        for raw in ["../x.png", "..", "/", "\\", "a/../b.png"] {
            if let safe = sanitizedFileName(raw) {
                #expect(!safe.contains("/"))
                #expect(!safe.contains("\\"))
            }
        }
    }

    @Test func shellMetacharactersAreRemovedRatherThanQuoted() {
        #expect(sanitizedFileName("需求 文档.pdf") == "需求-文档.pdf")
        #expect(sanitizedFileName("a&b.png") == "a-b.png")
        #expect(sanitizedFileName("a;rm -rf ~.png") == "a-rm-rf.png")
        #expect(sanitizedFileName("$(whoami).png") == "whoami.png")
        #expect(sanitizedFileName("a|b>c<d.png") == "a-b-c-d.png")
        // A leading dash reads as a flag to the very first command it meets.
        #expect(sanitizedFileName("-rf.png") == "rf.png")
        #expect(sanitizedFileName("--help") == "help")
    }

    @Test func separatorsCollapseTheWayTheDesktopsDo() {
        // The desktop's `-{2,}` pass sees a literal hyphen as a separator too, and
        // a name that came out `a--b` here would be `a-b` there.
        #expect(sanitizedFileName("a--b.png") == "a-b.png")
        #expect(sanitizedFileName("a  b.png") == "a-b.png")
        #expect(sanitizedFileName("a - b.png") == "a-b.png")
    }

    @Test func unusableNamesAreRefusedRatherThanInvented() {
        #expect(sanitizedFileName("") == nil)
        #expect(sanitizedFileName("..") == nil)
        #expect(sanitizedFileName(".") == nil)
        #expect(sanitizedFileName("-") == nil)
        #expect(sanitizedFileName("   ") == nil)
        #expect(sanitizedFileName("/") == nil)
    }

    @Test func truncationKeepsTheExtension() {
        let long = String(repeating: "x", count: 200) + ".png"
        let safe = sanitizedFileName(long)
        #expect(safe != nil)
        #expect(safe!.count <= maxRelayedFileNameLength)
        #expect(safe!.hasSuffix(".png"))
    }

    @Test func generatedNamesAreTimestamped() throws {
        var components = DateComponents()
        components.year = 2026
        components.month = 9
        components.day = 16
        components.hour = 20
        components.minute = 13
        let date = try #require(Calendar(identifier: .gregorian).date(from: components))

        #expect(generatedFileName(prefix: "粘贴图片", extension: "png", at: date) == "粘贴图片-20260916-2013.png")
        #expect(generatedFileName(prefix: "照片", extension: "jpg", at: date) == "照片-20260916-2013.jpg")
    }
}

/// The two limits on a selection, checked where the user can still do something
/// about them rather than after an upload that was never going to be accepted.
struct RelaySelectionTests {
    private func file(_ name: String, bytes: Int64 = 1_024) -> PickedFile {
        PickedFile(url: URL(fileURLWithPath: "/tmp/\(name)"), name: name, size: bytes, mimeType: "image/png")
    }

    @Test func aFileOverTheCeilingIsRefusedWithItsOwnReason() throws {
        let tooBig = file("huge.mov", bytes: Int64(AppConfiguration.relayMaxFileBytes) + 1)
        let (accepted, rejections) = screenPickedFiles([file("ok.png"), tooBig], alreadyWaiting: 0)

        #expect(accepted.map(\.name) == ["ok.png"])
        #expect(rejections.count == 1)
        // The reason names the file: a batch of nine that silently drops one is
        // worse than one that says which.
        if case .tooLarge(let name, _) = try #require(rejections.first) {
            #expect(name == "huge.mov")
        } else {
            Issue.record("expected a size rejection")
        }
    }

    @Test func exactlyTheCeilingIsAllowed() {
        let atLimit = file("edge.bin", bytes: Int64(AppConfiguration.relayMaxFileBytes))
        let (accepted, rejections) = screenPickedFiles([atLimit], alreadyWaiting: 0)
        #expect(accepted.count == 1)
        #expect(rejections.isEmpty)
    }

    @Test func theCountIsSharedWithWhatIsAlreadyInFlight() {
        // Eight already waiting leaves room for one, not nine — the limit is on the
        // batch the terminal is about to receive, not on each pick.
        let eight = (0..<AppConfiguration.relayMaxFileCount).map { file("\($0).png") }
        let (accepted, rejections) = screenPickedFiles(eight, alreadyWaiting: AppConfiguration.relayMaxFileCount)
        #expect(accepted.isEmpty)
        #expect(rejections == [.tooMany(limit: AppConfiguration.relayMaxFileCount)])
    }

    @Test func aFullSelectionIsCutOffRatherThanRefusedWholesale() {
        let nine = (0..<12).map { file("\($0).png") }
        let (accepted, rejections) = screenPickedFiles(nine, alreadyWaiting: 0)
        #expect(accepted.count == AppConfiguration.relayMaxFileCount)
        #expect(rejections == [.tooMany(limit: AppConfiguration.relayMaxFileCount)])
    }
}

/// Which uploads the phone still owes a delivery.
///
/// A class rather than a struct so the suite it writes to can be removed when the
/// test ends: `UserDefaults(suiteName:)` leaves a plist behind in the host app's
/// container, and a run that litters is a run that makes the next one harder to
/// read.
///
/// Serialized because every case here writes to that one shared suite and `deinit`
/// deletes it. Run in parallel — which is the default — the `deinit` of whichever case
/// finishes first lands in the middle of another one's `record` / re-open pair and
/// takes its data with it, so `theLedgerIsPersisted` read back an empty ledger about
/// half the time. The alternative is a suite name per case, which loses the shared
/// cleanup this deliberately relies on.
@Suite(.serialized)
final class RelayLedgerTests {
    private static let suiteName = "SynapseRelayLedgerTests"

    deinit {
        UserDefaults().removePersistentDomain(forName: Self.suiteName)
    }

    private func freshLedger() throws -> RelayLedger {
        let defaults = try #require(UserDefaults(suiteName: Self.suiteName))
        defaults.removePersistentDomain(forName: Self.suiteName)
        return RelayLedger(defaults: defaults)
    }

    @Test func aRecordedItemSurvivesAndIsSweptOnlyAfterTheWindow() throws {
        var ledger = try freshLedger()
        let uploaded = Date(timeIntervalSince1970: 1_000_000)
        ledger.record(itemId: "item-1", ownerEmail: "owner@example.com", at: uploaded)

        #expect(ledger.all.count == 1)
        #expect(ledger.expired(now: uploaded.addingTimeInterval(60), ownerEmail: "owner@example.com").isEmpty)
        #expect(ledger.expired(now: uploaded.addingTimeInterval(AppConfiguration.relayPendingExpiry - 1), ownerEmail: "owner@example.com").isEmpty)
        #expect(ledger.expired(now: uploaded.addingTimeInterval(AppConfiguration.relayPendingExpiry), ownerEmail: "owner@example.com").count == 1)
    }

    @Test func aConfirmedDeliveryIsForgotten() throws {
        var ledger = try freshLedger()
        ledger.record(itemId: "item-1")
        ledger.resolve(itemId: "item-1")
        // Nothing left to sweep, which is what stops a delivered file from being
        // deleted out of the drive after the fact.
        #expect(ledger.all.isEmpty)
    }

    @Test func recordingIsIdempotent() throws {
        var ledger = try freshLedger()
        ledger.record(itemId: "item-1", at: Date(timeIntervalSince1970: 1_000_000))
        ledger.record(itemId: "item-1", at: Date(timeIntervalSince1970: 2_000_000))
        // A resend must not restart the clock on a file that has been waiting.
        #expect(ledger.all.count == 1)
        #expect(ledger.all.first?.uploadedAt == Date(timeIntervalSince1970: 1_000_000))
    }

    @Test func theLedgerIsPersisted() throws {
        let defaults = try #require(UserDefaults(suiteName: Self.suiteName))
        defaults.removePersistentDomain(forName: Self.suiteName)

        var first = RelayLedger(defaults: defaults)
        first.record(itemId: "item-1")
        // A phone that was killed before the computer answered still has to know
        // what it left in the drive when it comes back.
        let second = RelayLedger(defaults: defaults)
        #expect(second.all.map(\.itemId) == ["item-1"])
    }

    @Test func pendingItemsStayWithTheirAccount() throws {
        var ledger = try freshLedger()
        ledger.record(itemId: "first", ownerEmail: "first@example.com")
        ledger.record(itemId: "second", ownerEmail: "second@example.com")

        #expect(ledger.entries(forAccount: "first@example.com").map(\.itemId) == ["first"])
        #expect(ledger.entries(forAccount: "second@example.com").map(\.itemId) == ["second"])
        #expect(RelayLedger(defaults: try #require(UserDefaults(suiteName: Self.suiteName)))
            .entries(forAccount: "first@example.com").map(\.itemId) == ["first"])
    }

    @Test func olderLedgerEntriesRemainReadable() throws {
        let defaults = try #require(UserDefaults(suiteName: Self.suiteName))
        defaults.removePersistentDomain(forName: Self.suiteName)
        defaults.set(Data(#"[{"itemId":"legacy","uploadedAt":0}]"#.utf8), forKey: "SynapseRelayLedger")

        let ledger = RelayLedger(defaults: defaults)
        #expect(ledger.all.map(\.itemId) == ["legacy"])
        #expect(ledger.entries(forAccount: "another@example.com").map(\.itemId) == ["legacy"])
    }
}

/// What a chip in the strip is allowed to claim.
struct TerminalAttachmentStateTests {
    private func attachment(_ state: TerminalAttachment.State) -> TerminalAttachment {
        TerminalAttachment(
            id: "a1", name: "a.png", sessionId: "s1",
            desktopClientInstanceId: "desktop-1",
            intentId: "i1", driveItemId: nil, state: state
        )
    }

    /// The reason was carried on `.failed` but never read, so a file that did not
    /// arrive was described as "没有送达" and nothing else. Which reason it was is the
    /// part that decides whether retrying is worth it, so it is the part that must
    /// not go missing.
    @Test func aFailureSaysWhyItFailed() {
        #expect(
            attachment(.failed("传输没有完成，请重试。")).stateDescription == "传输没有完成，请重试。"
        )
    }

    /// A transfer can fail without the desktop saying anything useful. The chip still
    /// has to describe itself rather than announce an empty sentence.
    @Test func aFailureWithNothingToSayFallsBackToThePlainWord() {
        #expect(attachment(.failed("")).stateDescription == "没有送达")
    }

    @Test func theStatesThatAreNotFailuresKeepTheirOwnWords() {
        #expect(attachment(.queued).stateDescription == "准备上传")
        #expect(attachment(.uploading(nil)).stateDescription == "上传中")
        #expect(attachment(.waitingForComputer).stateDescription == "等待电脑接收")
        #expect(attachment(.receiving(nil)).stateDescription == "电脑正在接收")
        #expect(attachment(.delivered(path: nil)).stateDescription == "已送达")
    }

    @Test func onlyAQueuedTransferIsUploaded() {
        #expect(attachment(.queued).needsUpload)
        // A file with a drive item that is uploaded again becomes a second file on
        // the computer, which is the failure this guards.
        #expect(!attachment(.uploading(0.5)).needsUpload)
        #expect(!attachment(.waitingForComputer).needsUpload)
        #expect(!attachment(.delivered(path: "/tmp/a.png")).needsUpload)
        #expect(!attachment(.failed("no")).needsUpload)
    }

    @Test func onlyADeliveredPathCanBeUndone() {
        #expect(attachment(.delivered(path: "/tmp/a.png")).insertedPath == "/tmp/a.png")
        // The file landed but nothing was typed, so there is nothing to take back.
        #expect(attachment(.delivered(path: nil)).insertedPath == nil)
        #expect(attachment(.waitingForComputer).insertedPath == nil)
        #expect(attachment(.failed("no")).insertedPath == nil)
    }

    @Test func aFileWaitingOnAnAbsentComputerCanStillBeGotRidOf() {
        // The batch limit counts what is still waiting, so a file that could not be
        // dismissed would leave a user whose computer stayed offline unable to send
        // anything at all.
        #expect(attachment(.waitingForComputer).canBeDismissed)
        #expect(attachment(.failed("no")).canBeDismissed)
        #expect(attachment(.delivered(path: "/tmp/a.png")).canBeDismissed)
        // But not while the bytes are still moving: there is nothing to take back yet.
        #expect(!attachment(.queued).canBeDismissed)
        #expect(!attachment(.uploading(0.5)).canBeDismissed)
    }

    @Test func aRetryIsOfferedOnlyWhereThereIsSomethingToRetryWith() {
        let uploaded = TerminalAttachment(
            id: "a1", name: "a.png", sessionId: "s1",
            desktopClientInstanceId: "desktop-1",
            intentId: "i1", driveItemId: "item-1", state: .failed("电脑没有接收")
        )
        // The bytes are in the drive, so sending it again can work.
        #expect(uploaded.canRetry)

        // A failure on the way up left nothing behind: the picker's copy has been
        // discarded and there is no drive item, so a retry button would only fail
        // again.
        #expect(!attachment(.failed("上传失败")).canRetry)
        #expect(!attachment(.delivered(path: "/tmp/a.png")).canRetry)
    }

    @Test func aWaitingTransferKeepsTheIntentIdItWillBeResentWith() {
        // The id is fixed at creation and the same one is reused on every resend,
        // which is what lets the desktop dedupe a file it has already been told
        // about.
        let first = attachment(.waitingForComputer)
        #expect(first.intentId == "i1")
    }

    @Test func aFileTheComputerIsFetchingIsNotUploadedOrRemovable() {
        #expect(!attachment(.receiving(nil)).needsUpload)
        #expect(!attachment(.receiving(0.4)).needsUpload)
        // The bytes are coming down on the other side. Taking the file off the strip
        // would delete the drive copy the computer is reading from.
        #expect(!attachment(.receiving(0.4)).canBeDismissed)
        #expect(!attachment(.receiving(0.4)).canRetry)
        #expect(attachment(.receiving(0.4)).insertedPath == nil)
    }
}

/// What one progress report from the computer does to a chip.
struct RelayTransferProgressTests {
    @Test func theFirstReportIsWhatTurnsWaitingIntoReceiving() {
        // Zero of zero is the computer saying it has begun, before it knows how much
        // there is. A file that has stopped waiting must stop saying it is waiting.
        #expect(
            attachmentStateAfterTransferProgress(.waitingForComputer, completedBytes: 0, totalBytes: 0)
                == .receiving(nil)
        )
    }

    @Test func aKnownLengthBecomesAFraction() {
        #expect(
            attachmentStateAfterTransferProgress(.waitingForComputer, completedBytes: 512, totalBytes: 4096)
                == .receiving(0.125)
        )
    }

    @Test func anUnknownLengthStaysIndeterminateRatherThanFull() {
        // Reporting `completed` as the total would draw a bar that is already full
        // for a download that has just started.
        #expect(
            attachmentStateAfterTransferProgress(.receiving(nil), completedBytes: 900_000, totalBytes: 0)
                == .receiving(nil)
        )
    }

    @Test func aReportNeverMovesAFinishedTransferBackwards() {
        // A report that crossed the computer's own answer on the way here. Letting it
        // land would put a file that is already on the computer back into a state
        // that says it is still coming.
        #expect(attachmentStateAfterTransferProgress(.delivered(path: "/tmp/a.png"), completedBytes: 10, totalBytes: 20) == nil)
        #expect(attachmentStateAfterTransferProgress(.failed("no"), completedBytes: 10, totalBytes: 20) == nil)
    }

    @Test func aReportDoesNotTurnThisPhoneIntoTheOneUploading() {
        // The states below describe bytes going the other way. A report is the
        // computer talking about its own download, so it has nothing to say here.
        #expect(attachmentStateAfterTransferProgress(.queued, completedBytes: 10, totalBytes: 20) == nil)
        #expect(attachmentStateAfterTransferProgress(.uploading(0.5), completedBytes: 10, totalBytes: 20) == nil)
    }

    @Test func aFractionIsNeverOutOfRange() {
        // A body longer than its declared length is a real case, and a bar drawn past
        // full is the same as no bar at all.
        #expect(
            attachmentStateAfterTransferProgress(.receiving(nil), completedBytes: 3000, totalBytes: 1000)
                == .receiving(1)
        )
    }
}

/// What a chip's menu is allowed to offer.
struct RelayActionMenuTests {
    private func attachment(
        _ state: TerminalAttachment.State,
        driveItemId: String? = nil
    ) -> TerminalAttachment {
        TerminalAttachment(
            id: "a1", name: "a.png", sessionId: "s1",
            desktopClientInstanceId: "desktop-1",
            intentId: "i1", driveItemId: driveItemId, state: state
        )
    }

    @Test func aTransferThatIsStillMovingOffersNothing() {
        // An empty menu opens onto a blank sheet and reads as a bug, so the strip
        // draws these as plain chips instead.
        #expect(attachment(.queued).availableActions.isEmpty)
        #expect(attachment(.uploading(0.5)).availableActions.isEmpty)
        #expect(attachment(.receiving(0.5)).availableActions.isEmpty)
    }

    @Test func aDeliveredFileOffersUndoAndRemoval() {
        #expect(attachment(.delivered(path: "/tmp/a.png")).availableActions == [.undoInsert, .dismiss])
        // A file that landed without a path was never typed, so there is nothing to
        // take back out of the terminal.
        #expect(attachment(.delivered(path: nil)).availableActions == [.dismiss])
    }

    @Test func aFailureOffersARetryOnlyWhenThereIsSomethingToResend() {
        #expect(attachment(.failed("no"), driveItemId: "item-1").availableActions == [.retry, .dismiss])
        // Nothing was uploaded, so a retry would fail the same way immediately.
        #expect(attachment(.failed("no")).availableActions == [.dismiss])
    }

    @Test func aFileWaitingOnAnAbsentComputerCanStillBeGotRidOf() {
        #expect(attachment(.waitingForComputer).availableActions == [.dismiss])
    }

    @Test func removalIsTheOneThatTakesSomethingAway() {
        #expect(TerminalAttachment.Action.dismiss.isDestructive)
        #expect(!TerminalAttachment.Action.undoInsert.isDestructive)
        #expect(!TerminalAttachment.Action.retry.isDestructive)
    }

    @Test func everyActionHasALabel() {
        for action in TerminalAttachment.Action.allCases {
            #expect(!action.label.isEmpty)
        }
    }
}

/// What a submitted line takes off the strip with it.
struct RelayCommitTests {
    private func attachment(
        _ id: String,
        session: String,
        _ state: TerminalAttachment.State
    ) -> TerminalAttachment {
        TerminalAttachment(
            id: id, name: "\(id).png", sessionId: session,
            desktopClientInstanceId: "desktop-1",
            intentId: "i-\(id)", driveItemId: nil, state: state
        )
    }

    @Test func submittingTakesOffOnlyTheFilesThatLanded() {
        let attachments = [
            attachment("landed", session: "s1", .delivered(path: "/tmp/a.png")),
            attachment("waiting", session: "s1", .waitingForComputer),
            attachment("failed", session: "s1", .failed("电脑没有接收")),
            attachment("queued", session: "s1", .queued),
            attachment("uploading", session: "s1", .uploading(0.5)),
        ]
        // Only the delivered one. The rest still have something to say — bytes to
        // send, a computer to wait for, or a retry the user may yet take — and a
        // chip that vanished mid-upload would look like the file was dropped.
        #expect(committedAttachmentIds(attachments, sessionId: "s1") == ["landed"])
    }

    @Test func oneTerminalDoesNotClearAnothersChips() {
        let attachments = [
            attachment("mine", session: "s1", .delivered(path: "/tmp/a.png")),
            attachment("theirs", session: "s2", .delivered(path: "/tmp/b.png")),
        ]
        // Submitting in one terminal says nothing about what another terminal's
        // prompt still holds.
        #expect(committedAttachmentIds(attachments, sessionId: "s1") == ["mine"])
    }

    @Test func aFileThatLandedWithoutAPathStillGoes() {
        let attachments = [attachment("landed", session: "s1", .delivered(path: nil))]
        // The desktop got the file but could not type its path. There was never an
        // undo to offer, and the transfer itself is over.
        #expect(committedAttachmentIds(attachments, sessionId: "s1") == ["landed"])
    }

    @Test func aStripWithNothingDeliveredKeepsEverything() {
        let attachments = [
            attachment("waiting", session: "s1", .waitingForComputer),
            attachment("failed", session: "s1", .failed("上传失败")),
        ]
        #expect(committedAttachmentIds(attachments, sessionId: "s1").isEmpty)
    }
}

/// What the intake makes of a video.
///
/// A video is the same kind of thing as a picture to everything past the picker —
/// the drive stores its bytes, the desktop splits its name — so the phone is the
/// only side that has an opinion. It used to have two: the library offered stills
/// only, and the intake asked each item for an image representation, which a video
/// has none of. The first of those is a picker setting; this covers the second,
/// which is the one that would drop a video silently.
struct TerminalFileIntakeVideoTests {
    /// A QuickTime header, which is also what the image branch would destroy.
    private static let movieBytes: [UInt8] = [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70]

    private func temporaryFile(named name: String, bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("intake-\(UUID().uuidString)-\(name)")
        try Data(bytes).write(to: url)
        return url
    }

    @Test func aVideoItemIsAskedForAsAMovieRatherThanDropped() async throws {
        let source = try temporaryFile(named: "clip.mov", bytes: Self.movieBytes)
        defer { try? FileManager.default.removeItem(at: source) }
        // The same provider a real library item arrives as: built from the file.
        let provider = try #require(NSItemProvider(contentsOf: source))

        let file = try #require(
            await TerminalFileIntake.prepare(provider: provider),
            "a video provider was dropped — the intake asked for a representation it does not have"
        )
        #expect(file.name.hasSuffix(".mov"))
        #expect(file.mimeType == "video/quicktime")
    }

    @Test func aMoviesBytesSurviveTheImageNormalizing() async throws {
        let source = try temporaryFile(named: "clip.mov", bytes: Self.movieBytes)
        defer { try? FileManager.default.removeItem(at: source) }
        let provider = try #require(NSItemProvider(contentsOf: source))

        let file = try #require(await TerminalFileIntake.prepare(provider: provider))
        // Only HEIC is re-encoded; anything else has to arrive byte for byte.
        #expect(try Data(contentsOf: file.url) == Data(Self.movieBytes))
        #expect(file.size == Int64(Self.movieBytes.count))
    }

    @Test func aCameraRecordingArrivesUnderANameTheUserWouldRecognize() async throws {
        let source = try temporaryFile(named: "3A1B2C3D-4E5F.MOV", bytes: Self.movieBytes)
        defer { try? FileManager.default.removeItem(at: source) }

        let file = try #require(await TerminalFileIntake.prepare(cameraVideo: source))
        // The picker's own scratch name is not one to hand a person.
        #expect(file.name.hasPrefix("视频-"))
        #expect(file.name.hasSuffix(".mov"))
        #expect(!file.name.contains("3A1B2C3D"))
    }

    @Test func theCameraStopsRecordingWhereTheUploadWouldRefuseIt() {
        // Recording past the relay's ceiling only produces a file that gets refused,
        // so the two are the same limit seen from two sides and have to move
        // together. At the bitrate the constant is derived with, a recording that
        // runs its full length still fits.
        let bytesAtFullLength = AppConfiguration.relayCameraVideoSeconds * 2 * 1024 * 1024
        #expect(bytesAtFullLength <= Double(AppConfiguration.relayMaxFileBytes))
        // And it is a real cap, not the picker's own ten minutes.
        #expect(AppConfiguration.relayCameraVideoSeconds < 600)
    }
}

/// Which terminal messages are allowed to leave on their own, and which have to be
/// dismissed by hand.
///
/// The rule has to be narrow in both directions. Too wide, and a user who was mid
/// dictation loses the only account of why their words never landed. Too narrow, and
/// the row outlives the outage it describes — which is how a phone with a perfectly
/// good connection ends up being told the network is down.
struct TerminalMessageExpiryTests {
    private func row(_ id: String) -> TerminalMessage {
        TerminalMessage(id: id, sessionId: "session", text: "…")
    }

    @Test func theTwoNetworkReportsExpire() {
        #expect(row(TerminalMessageId.voiceOffline).expiresWithConnectivity)
        #expect(row(TerminalMessageId.voiceNetwork).expiresWithConnectivity)
    }

    @Test func answersToAnActionOutliveTheOutage() {
        // Every id below is one a raise site really uses, and every one of them is
        // still true once the connection is back: 没听到 is about one recording,
        // 未配置 is about the platform, 被打断 is about a phone call, a refused file
        // is about the file, and a permission prompt has to wait for Settings. None
        // of them are answered by the network returning.
        let survivors = [
            "text:\(VoiceInputController.Failure.noSpeech.message)",
            "text:\(VoiceInputController.Failure.notConfigured.message)",
            "text:\(HoldToTalkPresentation.interruptedNotice)",
            "text:电脑离线，命令没有发送。",
            "text:没有读取到可发送的文件。",
            "voice.notice",
        ]
        for id in survivors {
            #expect(!row(id).expiresWithConnectivity, "「\(id)」不该自己消失")
        }
    }
}
