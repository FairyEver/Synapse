import Foundation
import Testing
@testable import SynapseMobile

/// 上传队列的四条不变量与两条约定：进度各归各行、并发上限 2、一项失败不牵连其余项、
/// 取消要放掉配额、地址过期只重签一次、同名覆盖先问过再盖。
///
/// 这里没有服务端：`DriveUploadTransport` 那四件外部事情全是闭包，换掉它们就能把
/// 「prepare 了几次、什么时候停住、取消有没有放配额」逐条钉住。
@MainActor
struct DriveUploaderTests {
    /// 假装的服务端 + 假装的对象存储。
    @MainActor
    final class FakeDrive {
        struct PrepareCall {
            let name: String
            let size: Int64
            let mimeType: String?
            let parentId: String?
            let expectedItemId: String?
        }

        /// 每一次 prepare 的参数，按调用顺序。
        var prepares: [PrepareCall] = []
        /// prepare 返回的覆盖目标；nil 表示服务端没说目标位置有同名文件。
        var overwriteTarget: DriveUploadOverwriteTarget?
        var prepareError: Error?

        /// 这些会话上的 PUT 会失败。
        var failingSessions: Set<String> = []
        /// 所有 PUT 都失败。
        var putAlwaysFails = false
        /// PUT 抛这个错。默认是「上传地址不认了」那一条。
        var putError: Error = APIError(status: 403, code: "expired", message: "上传地址已过期，请重试。")
        /// PUT 卡住不走。取消与后台那两条用例要在「正在传」的当口动手。
        var holdPuts = false
        /// prepare 卡到这一趟被取消为止才把票交回来。
        var holdsPrepareUntilCancelled = false
        /// 放掉一条预留时卡到这一趟被取消为止（重签之前放旧预留那一下）。
        var holdsReleaseUntilCancelled = false
        /// 每一次 PUT 报的分数，按会话名给。乱序到达也照原样报。
        var fractions: [String: [Double]] = [:]
        /// PUT 里要做点别的。
        var onPut: (@MainActor () -> Void)?

        var puts = 0
        /// 真的收到字节的会话，按收到顺序。
        var delivered: [String] = []
        var inFlight = 0
        var maxInFlight = 0
        var completeError: Error?
        /// complete 成功的会话。
        var completed: [String] = []
        /// 被放掉的会话：取消、重签之前、确认覆盖之前。
        var released: [String] = []

        /// 这个名字准备过几次（重签会再来一次）。
        private var prepareCounts: [String: Int] = [:]
        /// 会话 id → 那一项在云盘里的 id。
        private var itemIds: [String: String] = [:]

        func prepare(
            name: String,
            size: Int64,
            mimeType: String?,
            parentId: String?,
            expectedItemId: String?
        ) async throws -> APIClient.DriveUploadTicket {
            prepares.append(PrepareCall(
                name: name, size: size, mimeType: mimeType,
                parentId: parentId, expectedItemId: expectedItemId
            ))
            if let prepareError { throw prepareError }
            // 会话名按「这个名字第几次 prepare」编：并发下两项谁先 prepare 是不定的，
            // 名字里带上文件名，断言才不用管谁先谁后。
            let attempt = (prepareCounts[name] ?? 0) + 1
            prepareCounts[name] = attempt
            let sessionId = "s\(attempt)-\(name)"
            itemIds[sessionId] = "item-\(name)"
            if holdsPrepareUntilCancelled { await waitForCancellation() }
            return APIClient.DriveUploadTicket(
                sessionId: sessionId,
                item: APIClient.DriveItem(id: "item-\(name)", name: name, size: String(size)),
                upload: APIClient.DriveUploadTicket.Destination(
                    method: "PUT",
                    url: "https://bucket.example/put/\(sessionId)",
                    expiresAt: "2026-09-25T02:30:00.000Z",
                    headers: ["Content-Type": mimeType ?? "application/octet-stream"]
                ),
                overwrite: overwriteTarget
            )
        }

        func put(
            fileURL: URL,
            destination: String,
            headers: [String: String],
            onProgress: @escaping @Sendable (Double) -> Void
        ) async throws {
            puts += 1
            inFlight += 1
            maxInFlight = max(maxInFlight, inFlight)
            defer { inFlight -= 1 }
            onPut?()
            let sessionId = String(destination.dropFirst("https://bucket.example/put/".count))
            for fraction in fractions[sessionId] ?? [0.5] { onProgress(fraction) }
            if holdPuts {
                try await Task.sleep(for: .seconds(30))
            } else {
                // 让出一次，好让「同一时刻最多两项在传」这件事有机会被违反。
                try? await Task.sleep(for: .milliseconds(5))
            }
            if putAlwaysFails || failingSessions.contains(sessionId) { throw putError }
            delivered.append(sessionId)
        }

        func complete(sessionId: String) async throws -> APIClient.DriveItem {
            if let completeError { throw completeError }
            completed.append(sessionId)
            return APIClient.DriveItem(
                id: itemIds[sessionId] ?? "item",
                name: "报告.md",
                size: "12"
            )
        }

        func cancel(sessionId: String) async throws {
            released.append(sessionId)
            if holdsReleaseUntilCancelled { await waitForCancellation() }
        }

        /// 停在这里，直到**这一趟上传**被取消。
        ///
        /// 用 `try?` 吞掉 `CancellationError`，所以等待本身不理会取消：真实世界里用户按了
        /// 取消，那个请求的响应照样会回来。要的正是「票已经在手上、这一趟却已经取消」那一
        /// 瞬——它才是「预留被漏掉」和「同一条会话被放两次」两个窗口的入口。
        private func waitForCancellation() async {
            // 有上界：等不到就往下走，让后面那条断言自己去失败，而不是把测试挂在这里。
            for _ in 0..<400 {
                if Task.isCancelled { return }
                try? await Task.sleep(for: .milliseconds(5))
            }
        }
    }

    /// `enqueue` 的签名要一个 `APIClient`。这批用例整套传输都注入了、一次网络都不会发，
    /// 所以它只是签名上的占位。
    private let client = APIClient(
        tokens: TokenStore(service: "com.liy.SynapseMobile.tests.drive-uploader"),
        onCredentialsChanged: {}
    )

    private func uploader(_ server: FakeDrive) -> DriveUploader {
        DriveUploader(transport: DriveUploadTransport(
            prepare: { name, size, mimeType, parentId, expectedItemId in
                try await server.prepare(
                    name: name, size: size, mimeType: mimeType,
                    parentId: parentId, expectedItemId: expectedItemId
                )
            },
            put: { fileURL, destination, headers, onProgress in
                try await server.put(
                    fileURL: fileURL, destination: destination,
                    headers: headers, onProgress: onProgress
                )
            },
            complete: { sessionId in try await server.complete(sessionId: sessionId) },
            cancel: { sessionId in try await server.cancel(sessionId: sessionId) }
        ))
    }

    private func file(_ name: String, bytes: Int = 12) -> PickedFile {
        PickedFile(
            url: URL(fileURLWithPath: "/tmp/drive-uploader-tests/\(name)"),
            name: name,
            size: Int64(bytes),
            mimeType: "text/markdown"
        )
    }

    /// 等到没有一项在排队或上传中。
    ///
    /// 有上界：等不到就直接返回，让后面那条断言自己去失败，而不是把测试挂在这里。
    private func settle(_ uploader: DriveUploader) async {
        for _ in 0..<400 {
            guard uploader.items.contains(where: { $0.state == .queued || $0.state == .uploading }) else {
                // 进度是 `Task { @MainActor }` 排进来的，可能比状态晚一步落地。
                for _ in 0..<8 { await Task.yield() }
                return
            }
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async {
        for _ in 0..<400 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    // MARK: - 进度

    /// 两趟同时在传，各自的进度落进各自那一行；迟到的旧分数不让进度条回退。
    @Test func progressLandsOnItsOwnRowAndNeverGoesBackwards() async {
        let server = FakeDrive()
        server.fractions = ["s1-a.md": [0.75, 0.25], "s2-b.md": [0.5]]
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md"), file("b.md")], parentId: nil, using: client)
        await settle(uploader)

        #expect(uploader.items.first { $0.name == "a.md" }?.progress == 0.75)
        #expect(uploader.items.first { $0.name == "b.md" }?.progress == 0.5)
    }

    // MARK: - 并发

    /// 一批一起飞会把上行分成几份，每一项都更慢——上限是 2。
    @Test func atMostTwoUploadsRunAtOnce() async {
        let server = FakeDrive()
        let uploader = uploader(server)

        uploader.enqueue(files: (1...5).map { file("f\($0).md") }, parentId: nil, using: client)
        await settle(uploader)

        #expect(server.maxInFlight == 2)
        #expect(server.completed.count == 5)
    }

    // MARK: - 逐项

    /// 一项失败不牵连其余项，失败的那一项留在列表里等重试。
    @Test func oneFailureLeavesTheOthersAlone() async {
        let server = FakeDrive()
        server.failingSessions = ["s1-b.md"]
        server.putError = APIError(status: 0, code: "network", message: "网络不可用，上传没有完成。")
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md"), file("b.md"), file("c.md")], parentId: "folder-1", using: client)
        await settle(uploader)

        func item(_ name: String) -> DriveUploadItem? { uploader.items.first { $0.name == name } }
        #expect(item("a.md")?.state == .completed(itemId: "item-a.md"))
        #expect(item("c.md")?.state == .completed(itemId: "item-c.md"))
        // 传输失败没有服务端那句话可读，落到云盘自己那句「网络不可用」上（`DriveText`）。
        #expect(item("b.md")?.message == DriveText.offlineErrorMessage)
        #expect(uploader.items.count == 3)
        // 失败的那条预留放掉了：它按字节占着配额。
        #expect(server.released == ["s1-b.md"])
    }

    @Test func aFailedItemCanBeRetriedOnItsOwn() async throws {
        let server = FakeDrive()
        server.failingSessions = ["s1-a.md"]
        server.putError = APIError(status: 0, code: "network", message: "网络不可用，上传没有完成。")
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md"), file("b.md")], parentId: nil, using: client)
        await settle(uploader)
        let failed = try #require(uploader.items.first { $0.name == "a.md" })
        #expect(failed.message == DriveText.offlineErrorMessage)

        uploader.retry(failed.id)
        await settle(uploader)

        #expect(uploader.items.first { $0.name == "a.md" }?.state == .completed(itemId: "item-a.md"))
        #expect(server.prepares.filter { $0.name == "a.md" }.count == 2)
    }

    // MARK: - 取消

    /// 取消要调服务端的 cancel：那条预留按字节占着配额，不主动放就只剩过期清扫。
    @Test func cancelStopsTheFlightAndReleasesTheReservation() async throws {
        let server = FakeDrive()
        server.holdPuts = true
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md")], parentId: nil, using: client)
        await waitUntil { server.puts > 0 }
        let item = try #require(uploader.items.first)

        await uploader.cancel(item.id)

        #expect(server.released == ["s1-a.md"])
        #expect(uploader.items.isEmpty)
    }

    /// 停在下场之后紧接着又传起来一项，说明取消把并发位还回去了。
    @Test func cancelFreesItsSlot() async throws {
        let server = FakeDrive()
        server.holdPuts = true
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md"), file("b.md"), file("c.md")], parentId: nil, using: client)
        await waitUntil { server.puts == 2 }
        let first = try #require(uploader.items.first)
        await uploader.cancel(first.id)

        await waitUntil { server.puts == 3 }
        #expect(server.puts == 3)

        // 剩下的两项还卡在 PUT 上（那一趟本来就是「一直不走」）；把它们也收掉，
        // 免得测试结束之后还有任务在跑。
        for item in uploader.items { await uploader.cancel(item.id) }
    }

    /// prepare 还在飞的时候取消：票回来时这一趟已经取消了，它占的那条预留也得放掉。
    ///
    /// 「点了上传马上又不要了」正好落在这个窗口里：票是不带取消语义回来的（服务端那一步
    /// 已经建了会话、按声明大小记了账），拿到票却因为已经取消直接 return 的话，`cancel`
    /// 从 `sessions` 里读不到它，就只能等服务端十五分钟的过期清扫。
    @Test func cancelDuringPrepareReleasesTheReservationItNeverUsed() async throws {
        let server = FakeDrive()
        server.holdsPrepareUntilCancelled = true
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md")], parentId: "folder-1", using: client)
        await waitUntil { server.prepares.count == 1 }
        let item = try #require(uploader.items.first)

        // prepare 要等到这一趟被取消才把票交回来，所以这一句返回时正是「票到手、已取消」。
        await uploader.cancel(item.id)

        #expect(server.released == ["s1-a.md"])
        #expect(server.delivered.isEmpty)
        #expect(uploader.items.isEmpty)
    }

    /// 取消落在「重签」窗口里：旧那条预留已经放掉了，不能再放第二次。
    @Test func cancelDuringResignDoesNotReleaseTheSameSessionTwice() async throws {
        let server = FakeDrive()
        server.failingSessions = ["s1-a.md"]
        server.holdsReleaseUntilCancelled = true
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md")], parentId: nil, using: client)
        // 已经在放旧预留了（403 之后重签之前那一下）。
        await waitUntil { server.released.count == 1 }
        let item = try #require(uploader.items.first)

        await uploader.cancel(item.id)

        #expect(server.released == ["s1-a.md"])
        #expect(uploader.items.isEmpty)
    }

    // MARK: - 上传地址过期

    /// 地址过期不是失败，是重签一次的事。
    @Test func anExpiredUploadAddressIsRepreparedOnce() async {
        let server = FakeDrive()
        server.failingSessions = ["s1-a.md"]
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md")], parentId: "folder-1", using: client)
        await settle(uploader)

        #expect(server.prepares.count == 2)
        // 重签之后那一次落在同一个文件夹，而且不带覆盖授权——这一次没有问过覆盖。
        #expect(server.prepares[1].parentId == "folder-1")
        #expect(server.prepares[1].expectedItemId == nil)
        #expect(server.delivered == ["s2-a.md"])
        #expect(uploader.items[0].state == .completed(itemId: "item-a.md"))
        // 旧的那条预留放掉了：地址作废，那条预留也就不中用了。
        #expect(server.released == ["s1-a.md"])
    }

    /// 重签之后马上又过期，说明问题不在有效期上：到此为止。
    @Test func aSecondExpiryIsNotRepreparedAgain() async {
        let server = FakeDrive()
        server.putAlwaysFails = true
        let uploader = uploader(server)

        uploader.enqueue(files: [file("a.md")], parentId: nil, using: client)
        await settle(uploader)

        #expect(server.prepares.count == 2)
        #expect(server.puts == 2)
        #expect(uploader.items[0].message == "上传地址已过期，请重试。")
        #expect(server.released == ["s1-a.md", "s2-a.md"])
    }

    // MARK: - 同名覆盖

    /// `overwrite` 缺失 = 未知：不弹确认、不阻断。
    @Test func anAbsentOverwriteFieldUploadsWithoutAsking() async {
        let server = FakeDrive()
        let uploader = uploader(server)

        uploader.enqueue(files: [file("报告.md")], parentId: nil, using: client)
        await settle(uploader)

        #expect(server.prepares.count == 1)
        #expect(uploader.items[0].overwriteTarget == nil)
        #expect(uploader.items[0].state == .completed(itemId: "item-报告.md"))
    }

    /// `overwrite` 非空：先停下来问，确认之后带 `expectedItemId` 重新 prepare 再传。
    @Test func anOverwriteTargetPausesUntilTheUserConfirms() async throws {
        let server = FakeDrive()
        let target = DriveUploadOverwriteTarget(
            itemId: "old-1", name: "报告.md", currentVersionId: "v1", documentText: true
        )
        server.overwriteTarget = target
        let uploader = uploader(server)

        uploader.enqueue(files: [file("报告.md")], parentId: "folder-1", using: client)
        await settle(uploader)

        let item = try #require(uploader.items.first)
        #expect(item.state == .awaitingOverwrite(target))
        #expect(item.overwriteTarget == target)
        // 一个字节都没传。
        #expect(server.delivered.isEmpty)
        // 那一次 prepare 占下的预留先放掉：确认之后要重新 prepare，这一条用不上了。
        #expect(server.released == ["s1-报告.md"])

        uploader.confirmOverwrite(item.id)
        await settle(uploader)

        #expect(uploader.items[0].state == .completed(itemId: "item-报告.md"))
        #expect(server.prepares.count == 2)
        // 第一次不带（那时还不知道会撞名），确认之后那一次必须带上：服务端拿它核对目标在
        // 两次 prepare 之间没有被换掉。
        #expect(server.prepares[0].expectedItemId == nil)
        #expect(server.prepares[1].expectedItemId == "old-1")
        #expect(server.delivered == ["s2-报告.md"])
    }

    /// 覆盖授权不跟着重试走：带着旧凭据重试，会一直栽在「目标已经变了」上。
    @Test func aRetryAsksAboutTheOverwriteAgain() async throws {
        let server = FakeDrive()
        let target = DriveUploadOverwriteTarget(
            itemId: "old-1", name: "报告.md", currentVersionId: "v1", documentText: true
        )
        server.overwriteTarget = target
        server.putError = APIError(status: 0, code: "network", message: "网络不可用，上传没有完成。")
        server.failingSessions = ["s2-报告.md"]
        let uploader = uploader(server)

        uploader.enqueue(files: [file("报告.md")], parentId: nil, using: client)
        await settle(uploader)
        let paused = try #require(uploader.items.first)
        uploader.confirmOverwrite(paused.id)
        await settle(uploader)

        let failed = try #require(uploader.items.first)
        #expect(failed.message == DriveText.offlineErrorMessage)

        uploader.retry(failed.id)
        await settle(uploader)

        // 重试是一次新的尝试：重新 prepare 之后又看到同名文件，就再问一次。
        let asked = try #require(uploader.items.first)
        #expect(asked.state == .awaitingOverwrite(target))
        #expect(server.prepares.count == 3)
        #expect(server.prepares[2].expectedItemId == nil)
    }

    // MARK: - 离开 App

    /// 切后台之后丢掉的那一趟，不能报成网络问题。
    @Test func aFailureAfterLeavingTheAppSaysSo() async {
        let server = FakeDrive()
        server.putAlwaysFails = true
        server.putError = APIError(status: 0, code: "network", message: "网络不可用，上传没有完成。")
        let uploader = uploader(server)
        // 这一趟正在传的时候 App 被切到后台，系统把连接收了回去。
        server.onPut = { uploader.noteAppWentToBackground() }

        uploader.enqueue(files: [file("a.md")], parentId: nil, using: client)
        await settle(uploader)

        #expect(uploader.items[0].message == DriveUploader.leftAppMessage)
    }
}

/// `DriveFileIntake` 的取名规则：云盘不共用终端接力那套净化。
///
/// 放在同一个文件里而不是单开一个：这条规则错了不会崩，只会让用户的文件名在云盘里变样，
/// 而它正是「不要复用 `sanitizedFileName`」那件事的哨兵，跟上传一起看更近。
@MainActor
struct DriveFileIntakeNamingTests {
    @Test func keepsChineseSpacesAndBrackets() {
        #expect(DriveFileIntake.uploadName("需求规格.md", fallbackExtension: "md") == "需求规格.md")
        #expect(DriveFileIntake.uploadName("我的 报告 (1).md", fallbackExtension: "md") == "我的 报告 (1).md")
        #expect(DriveFileIntake.uploadName("会议纪要📝.txt", fallbackExtension: "txt") == "会议纪要📝.txt")
    }

    @Test func stripsPathSeparatorsAndOuterWhitespace() {
        #expect(DriveFileIntake.uploadName("a/b/报告.md", fallbackExtension: "") == "报告.md")
        #expect(DriveFileIntake.uploadName("报告.md\n", fallbackExtension: "") == "报告.md")
    }

    /// 相册给的 `suggestedName` 在有些 iOS 版本上没有扩展名，而扩展名决定服务端按什么
    /// 预览、别的机器能不能打开它。
    @Test func addsTheExtensionOnlyWhenItIsMissing() {
        #expect(DriveFileIntake.uploadName("IMG_0001", fallbackExtension: "heic") == "IMG_0001.heic")
        #expect(DriveFileIntake.uploadName("IMG_0001.JPG", fallbackExtension: "heic") == "IMG_0001.JPG")
        #expect(DriveFileIntake.uploadName("IMG_0001", fallbackExtension: "") == "IMG_0001")
    }

    @Test func hasNoNameWhenThereIsNothingToUse() {
        #expect(DriveFileIntake.uploadName("   ", fallbackExtension: "md") == nil)
        #expect(DriveFileIntake.uploadName("", fallbackExtension: "md") == nil)
    }

    /// 文件 App 那条路：名字原样、大小量得对。
    @Test func aDocumentKeepsItsOwnNameAndSize() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("drive-intake-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("需求规格.md")
        try Data("# 需求规格".utf8).write(to: url)

        let file = try #require(DriveFileIntake.prepare(documentURL: url))

        #expect(file.name == "需求规格.md")
        #expect(file.size == Int64("# 需求规格".utf8.count))
        // Apple 把 `md` 映射成 `text/x-markdown`（不是 IANA 的 `text/markdown`）；这里钉住
        // 实际会记进云盘的那个值，换成别的映射得是一次有意的改动。
        #expect(file.mimeType == "text/x-markdown")
    }
}
