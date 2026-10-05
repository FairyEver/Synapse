import Foundation
import Testing
@testable import SynapseMobile

/// 文件读取和链接查询必须真的跨越 await，再验证归属与当前状态。
@MainActor
struct DriveAsyncContextTests {
    @Test func navigationWhilePreparingKeepsTheOriginalUploadFolder() async {
        let gate = DriveContextGate()
        let file = PickedFile(url: URL(fileURLWithPath: "/unread/fixture"), name: "图片.png", size: 1, mimeType: nil)
        var folder = "first"
        let context = DriveUploadIntakeContext(accountGeneration: 1, parentId: folder)
        let preparation = Task {
            await context.prepare({ await gate.hold(); return [file] }, isCurrentAccount: { $0 == 1 })
        }
        await gate.waitUntilHeld()
        folder = "second"
        await gate.release()
        let prepared = await preparation.value
        #expect(prepared == [file])
        #expect(context.parentId == "first")
        #expect(folder == "second")
    }

    @Test func changingAccountWhilePreparingRejectsAndDiscardsTheOwnedCopy() async throws {
        let gate = DriveContextGate()
        let file = try temporaryFile()
        defer { DriveFileIntake.discard(file) }
        var account = 1
        let context = DriveUploadIntakeContext(accountGeneration: account, parentId: "first")
        let preparation = Task {
            await context.prepare({ await gate.hold(); return [file] }, isCurrentAccount: { $0 == account })
        }
        await gate.waitUntilHeld()
        account = 2
        await gate.release()
        #expect(await preparation.value == nil)
        #expect(!FileManager.default.fileExists(atPath: file.url.path))
    }

    @Test func cancellingPreparationDiscardsTheOwnedCopy() async throws {
        let gate = DriveContextGate()
        let file = try temporaryFile()
        defer { DriveFileIntake.discard(file) }
        let context = DriveUploadIntakeContext(accountGeneration: 1, parentId: nil)
        let preparation = Task {
            await context.prepare({ await gate.hold(); return [file] }, isCurrentAccount: { $0 == 1 })
        }
        await gate.waitUntilHeld()
        preparation.cancel()
        await gate.release()
        #expect(await preparation.value == nil)
        #expect(!FileManager.default.fileExists(atPath: file.url.path))
    }

    @Test func aCachedShareIsReadAndUsesTheFreshPassword() async {
        let known = share(password: "old")
        let fresh = share(password: "new")
        var readIds: [String] = []
        let lookup = await DriveShareLookup.read(known: known, browserPath: nil) { id in
            readIds.append(id)
            return .found(fresh)
        }
        #expect(readIds == [known.shareId])
        #expect(lookup == .found(fresh))
    }

    @Test func aCachedStoppedOrExpiredShareIsMissing() async {
        var reads = 0
        let lookup = await DriveShareLookup.read(known: share(password: "old"), browserPath: nil) { _ in
            reads += 1
            return DriveShareLookup.of(APIError(status: 404, code: nil, message: "分享不存在。"))
        }
        #expect(reads == 1)
        #expect(lookup == .missing)
    }

    @Test func aFailedCachedShareReadCannotBecomeAMissingShare() async {
        let lookup = await DriveShareLookup.read(known: share(password: "old"), browserPath: nil) { _ in
            .failed(reason: "网络不可用。")
        }
        #expect(lookup == .failed(reason: "网络不可用。"))
    }

    @Test func aShareWithoutAnyKnownIdDoesNotProbeOrCreate() async {
        var reads = 0
        let lookup = await DriveShareLookup.read(known: nil, browserPath: nil) { _ in
            reads += 1
            return .failed(reason: "不应读取")
        }
        #expect(reads == 0)
        #expect(lookup == .missing)
    }

    @Test func shareDetailsReplaceTheOldPasswordOnlyAfterTheReadCompletes() async {
        let state = DriveShareDetailState()
        await state.load(id: "shared", account: 1, isCurrentAccount: { $0 == 1 }) { _ in
            .found(share(password: "old"))
        }
        let gate = DriveContextGate()
        var readIds: [String] = []
        let refresh = Task {
            await state.load(id: "shared", account: 1, isCurrentAccount: { $0 == 1 }) { id in
                readIds.append(id)
                await gate.hold()
                return .found(share(password: "new"))
            }
        }
        await gate.waitUntilHeld()
        #expect(state.currentShare(account: 1) == nil)
        #expect(state.loading)
        await gate.release()
        await refresh.value
        #expect(readIds == ["shared"])
        #expect(state.currentShare(account: 1)?.password == "new")
        #expect(state.currentShare(account: 1)?.urlWithPassword.contains("password=new") == true)
    }

    @Test func failedAndMissingDetailReadsCannotExposeThePreviousCopyValues() async {
        let state = DriveShareDetailState()
        await state.load(id: "shared", account: 1, isCurrentAccount: { $0 == 1 }) { _ in
            .found(share(password: "old"))
        }
        await state.load(id: "shared", account: 1, isCurrentAccount: { $0 == 1 }) { _ in
            .failed(reason: "网络不可用。")
        }
        #expect(state.lookup == .failed(reason: "网络不可用。"))
        #expect(state.currentShare(account: 1) == nil)
        await state.load(id: "shared", account: 1, isCurrentAccount: { $0 == 1 }) { _ in .missing }
        #expect(state.lookup == .missing)
        #expect(state.currentShare(account: 1) == nil)
    }

    @Test func detailCopyValuesExpireAndBelongOnlyToTheAccountThatReadThem() async throws {
        let state = DriveShareDetailState()
        let expiry = "2026-10-05T00:00:00Z"
        await state.load(id: "shared", account: 1, isCurrentAccount: { $0 == 1 }) { _ in
            .found(share(password: "new", expiresAt: expiry))
        }
        let date = try #require(ISO8601DateFormatter.parseWireTimestamp(expiry))
        #expect(state.currentShare(account: 1, now: date.addingTimeInterval(-1)) != nil)
        #expect(state.currentShare(account: 1, now: date) == nil)
        #expect(state.currentShare(account: 2, now: date.addingTimeInterval(-1)) == nil)
    }

    @Test func shareResultValidityExpiresAtTheKnownBoundary() throws {
        let expiry = "2026-10-05T00:00:00.250Z"
        let value = share(password: "known", expiresAt: expiry)
        let date = try #require(ISO8601DateFormatter.parseWireTimestamp(expiry))
        for outcome in [DriveShareOutcome.created(value), .reused(value)] {
            let result = try #require(outcome.share)
            #expect(result.isActive(at: date.addingTimeInterval(-1)))
            #expect(!result.isActive(at: date))
            #expect(!result.isActive(at: date.addingTimeInterval(1)))
            #expect(result.password == "known")
        }
    }

    @Test func shareResultValidityRejectsDisabledAndUnreadableExpiry() {
        let now = Date(timeIntervalSince1970: 0)
        #expect(share(password: "known").isActive(at: now))
        #expect(!share(password: "known", expiresAt: "invalid").isActive(at: now))
        #expect(!share(password: "known", enabled: false).isActive(at: now))
    }

    @Test func aDetailReadFinishingAfterAccountChangeIsDiscarded() async {
        let state = DriveShareDetailState()
        let gate = DriveContextGate()
        var account = 1
        let read = Task {
            await state.load(id: "shared", account: account, isCurrentAccount: { $0 == account }) { _ in
                await gate.hold()
                return .found(share(password: "new"))
            }
        }
        await gate.waitUntilHeld()
        account = 2
        await gate.release()
        await read.value
        #expect(state.lookup == nil)
        #expect(state.currentShare(account: account) == nil)
    }

    @Test func moveTargetSecondPageFailureRetriesTheSameOffsetThenContinues() async {
        let pagination = DriveMoveTargetPagination()
        pagination.reset(nextOffset: 50)
        var offsets: [Int] = []
        let failed = await pagination.load(isCurrent: { true }) { offset in
            offsets.append(offset)
            throw APIError(status: 503, code: nil, message: "网络不可用。")
        }
        #expect(failed == nil)
        #expect(!pagination.loading)
        #expect(pagination.errorMessage != nil)
        #expect(pagination.nextOffset == 50)
        let second = await pagination.load(isCurrent: { true }) { offset in
            offsets.append(offset)
            return page(offset: offset, nextOffset: 100)
        }
        #expect(second?.children.first?.id == "folder-50")
        #expect(pagination.errorMessage == nil)
        #expect(pagination.nextOffset == 100)
        let final = await pagination.load(isCurrent: { true }) { offset in
            offsets.append(offset)
            return page(offset: offset, nextOffset: nil)
        }
        #expect(final?.children.first?.id == "folder-100")
        #expect(offsets == [50, 50, 100])
        #expect(pagination.nextOffset == nil)
        #expect(!pagination.loading)
    }

    @Test func moveTargetPaginationAllowsOnlyOneRequestAndDiscardsTheOldFolderPage() async {
        let pagination = DriveMoveTargetPagination()
        pagination.reset(nextOffset: 50)
        let gate = DriveContextGate()
        var offsets: [Int] = []
        let read = Task {
            await pagination.load(isCurrent: { true }) { offset in
                offsets.append(offset)
                await gate.hold()
                return page(offset: offset, nextOffset: 100)
            }
        }
        await gate.waitUntilHeld()
        let duplicate = await pagination.load(isCurrent: { true }) { offset in
            offsets.append(offset)
            return page(offset: offset, nextOffset: nil)
        }
        #expect(duplicate == nil)
        #expect(offsets == [50])
        pagination.reset(nextOffset: 200)
        await gate.release()
        #expect(await read.value == nil)
        #expect(pagination.nextOffset == 200)
        #expect(pagination.errorMessage == nil)
        #expect(!pagination.loading)
    }

    private func temporaryFile() throws -> PickedFile {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("drive-review-intake-\(UUID().uuidString).png")
        try Data([1]).write(to: url)
        return PickedFile(url: url, name: "图片.png", size: 1, mimeType: "image/png")
    }

    private func share(password: String, expiresAt: String? = nil, enabled: Bool = true) -> DriveShare {
        DriveShare(id: "record", shareId: "shared", itemId: "item", enabled: enabled,
                   url: "https://synapse.d2.pub/s/shared",
                   urlWithPassword: "https://synapse.d2.pub/s/shared?password=\(password)",
                   passwordEnabled: true, password: password, expiresAt: expiresAt,
                   accessMode: .linkRead, editorEmails: [], createdAt: "2026-09-25T00:00:00Z")
    }

    private func page(offset: Int, nextOffset: Int?) -> DriveBrowserSnapshot {
        let item = DriveBrowserItem(
            id: "folder-\(offset)", name: "文件夹", type: .folder, size: "0", mimeType: nil,
            updatedAt: "2026-10-05T00:00:00Z", previewKind: .downloadOnly,
            browserUrl: "https://synapse.d2.pub/drive/browser/owner/items/folder-\(offset)",
            downloadUrl: nil, shareUrl: nil
        )
        return DriveBrowserSnapshot(current: item, breadcrumbs: [], children: [item],
                                    childrenPage: DriveChildrenPage(offset: offset, limit: 50,
                                                                  hasMore: nextOffset != nil,
                                                                  nextOffset: nextOffset),
                                    preview: nil, canDownload: false, canZip: true)
    }
}

private actor DriveContextGate {
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
