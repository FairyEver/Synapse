import Foundation
import Testing

@testable import SynapseMobile

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
        ledger.record(itemId: "item-1", at: uploaded)

        #expect(ledger.all.count == 1)
        #expect(ledger.expired(now: uploaded.addingTimeInterval(60)).isEmpty)
        #expect(ledger.expired(now: uploaded.addingTimeInterval(AppConfiguration.relayPendingExpiry - 1)).isEmpty)
        #expect(ledger.expired(now: uploaded.addingTimeInterval(AppConfiguration.relayPendingExpiry)).count == 1)
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
}

/// What a chip in the strip is allowed to claim.
struct TerminalAttachmentStateTests {
    private func attachment(_ state: TerminalAttachment.State) -> TerminalAttachment {
        TerminalAttachment(
            id: "a1", name: "a.png", sessionId: "s1",
            intentId: "i1", driveItemId: nil, state: state
        )
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
}
