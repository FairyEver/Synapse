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
        #expect(attachment(.delivered(path: nil)).stateDescription == "已插入")
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
