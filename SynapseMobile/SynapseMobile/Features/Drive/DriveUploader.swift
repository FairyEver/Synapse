import Foundation
import Observation
import os
import UIKit

/// 预留一个位置，拿回这次要 PUT 到哪去。
///
/// `expectedItemId` 只有「确认覆盖那个同名文件」时才有值：服务端拿它核对目标在两次
/// prepare 之间没有被换掉。
typealias DriveUploadPreparer = @Sendable (
    _ name: String,
    _ size: Int64,
    _ mimeType: String?,
    _ parentId: String?,
    _ expectedItemId: String?
) async throws -> APIClient.DriveUploadTicket

/// 把文件 PUT 到预签名地址上，顺路报进度。真实的那一份是 `FileUploader`。
typealias DriveBytePutter = @Sendable (
    _ fileURL: URL,
    _ destination: String,
    _ headers: [String: String],
    _ onProgress: @escaping @Sendable (Double) -> Void
) async throws -> Void

/// 把预留变成云盘里一个真的文件。
typealias DriveUploadCompleter = @Sendable (_ sessionId: String) async throws -> APIClient.DriveItem

/// 放掉一条预留，连同它已经写进去的字节。
typealias DriveUploadCanceller = @Sendable (_ sessionId: String) async throws -> Void

/// 一趟上传要用到的四件外部事情。
///
/// 照 `MeetingUploader` 的 `send` / `abort` 那套：全部以闭包传入，单测换掉它们就不必
/// 真的起一个服务端，也不会有网络在测试里跑。
struct DriveUploadTransport {
    let prepare: DriveUploadPreparer
    let put: DriveBytePutter
    let complete: DriveUploadCompleter
    let cancel: DriveUploadCanceller
}

/// 一项上传在界面上的样子。
struct DriveUploadItem: Identifiable, Equatable {
    enum State: Equatable {
        /// 排队等一个并发位。
        case queued
        /// prepare 说目标位置已经有一个同名文件：等调用方问过用户再传。
        case awaitingOverwrite(DriveUploadOverwriteTarget)
        case uploading
        case completed(itemId: String)
        case failed(String)
    }

    let id: String
    let file: PickedFile
    /// 传到哪个文件夹。nil 是根。
    let parentId: String?
    /// 确认覆盖时服务端要的那个 id。没有覆盖授权时是 nil。
    var expectedItemId: String?
    var state: State
    /// 已经传了多少（0…1）。
    ///
    /// 与 `state` 分开：进度是另一条来源（`URLSession` 的 delegate 从别的线程推过来），
    /// 合成一个字段的话，一次状态迁移就会把进度条清零。
    var progress: Double

    var name: String { file.name }

    /// 待确认覆盖的那个目标；别的状态下是 nil。
    var overwriteTarget: DriveUploadOverwriteTarget? {
        if case .awaitingOverwrite(let target) = state { return target }
        return nil
    }

    /// 失败了要说给用户听的那句话；没失败是 nil。
    var message: String? {
        if case .failed(let message) = state { return message }
        return nil
    }
}

/// 云盘的上传队列。
///
/// 三条约定：**并发上限 2**、**不确认就不覆盖同名文件**、**上传地址过期就重签一次**。
///
/// 队列、进度与覆盖确认都在这里，视图只读 `items`：一项上传的全部过程（排队、要进度、
/// 暂停、失败、传完）都发生在同一个地方，界面上那一行就是它的一个切面。
///
/// `@Observable` 是那句「视图只读 `items`」成立的前提：上传那一组要看着进度条往前走、
/// 看着某一项从「上传中」变成「待确认覆盖」。普通 class 的 `private(set) var` 改动不会
/// 触发 SwiftUI 重绘，症状是进度行安安静静地不刷新。
@Observable
@MainActor
final class DriveUploader {
    /// 同时最多几项在传。
    ///
    /// 不是 1：两个文件排队传，第二个要一直等到第一个传完，而这两条路互不相干。也不是
    /// 更多：一批一起飞会把上行分成几份，每一项都更慢，而用户在看着每一行的进度条。
    nonisolated static let maxConcurrentUploads = 2

    /// 因为离开了 App 而中断的那句话。
    ///
    /// 切后台之后系统会把连接收回去，那一刻的失败**不是**网络问题——按网络说会让人去
    /// 检查 WiFi，而 WiFi 是好的。
    nonisolated static let leftAppMessage = "离开 App 导致上传中断，请重试。"

    private(set) var items: [DriveUploadItem] = []

    /// 单测注入的整套传输。给了它就不再看 `using client`。
    private let injected: DriveUploadTransport?
    /// 这一次用的那一套。真实那一套每次 `enqueue` 按传进来的 client 装一次。
    private var transport: DriveUploadTransport?
    /// 字节那条路自己的会话，与 `APIClient` 分开（见 `FileUploader` 上面那段说明）。
    private let bytes = FileUploader()

    private let maxConcurrent: Int
    private var running = 0
    /// 在飞的那一趟，按项 id。
    private var tasks: [String: Task<Void, Never>] = [:]
    /// 每一项此刻占着的上传会话。取消时拿它去放配额。
    private var sessions: [String: String] = [:]

    /// App 最近一次被切到后台的时刻。
    ///
    /// 判据是「这一趟在途中切成后台过」，不是「现在在不在后台」：失败的回调常常要等
    /// App 回到前台才轮得到执行，那时它看起来已经在前台了。
    private var leftAppAt: ContinuousClock.Instant?
    /// 观察者凭据不是界面状态，也**必须**是存储属性：`deinit` 不是 main actor 上的，
    /// 而 `@Observable` 会把普通属性换成 main actor 隔离的取值器，那里读不到。
    @ObservationIgnored private var backgroundObserver: NSObjectProtocol?

    init(
        transport: DriveUploadTransport? = nil,
        maxConcurrent: Int = DriveUploader.maxConcurrentUploads
    ) {
        self.injected = transport
        self.maxConcurrent = max(1, maxConcurrent)
        observeBackground()
    }

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    }

    // MARK: - 排队

    /// 排一批文件。
    ///
    /// 一项失败不影响其余项：每一项自己走一遍 prepare → PUT → complete，互不相干
    /// （Spec §5.2 的逐项语义在这里也是逐项）。
    func enqueue(files: [PickedFile], parentId: String?, using client: APIClient) {
        transport = injected ?? live(client)
        items.append(contentsOf: files.map {
            DriveUploadItem(
                id: UUID().uuidString,
                file: $0,
                parentId: parentId,
                expectedItemId: nil,
                state: .queued,
                progress: 0
            )
        })
        pump()
    }

    /// 用户确认「就是要盖掉那个同名文件」。
    ///
    /// 确认之后是**重新** prepare 一次，不是把暂停的那一次接着往下走：服务端只认
    /// 带 `expectedItemId` 的那一次覆盖，而那个参数只能在 prepare 的时候给。
    func confirmOverwrite(_ id: String) {
        guard let index = index(of: id),
              case .awaitingOverwrite(let target) = items[index].state
        else { return }
        items[index].expectedItemId = target.itemId
        items[index].state = .queued
        pump()
    }

    /// 失败的那一项再试一次。
    ///
    /// 覆盖授权**不**跟着重试走。那是一次 prepare 给出的、只对那一次有效的凭据（服务端
    /// 拿它核对目标没被换掉），而这一次可能正是栽在「目标已经变了」上：带着旧凭据重试会
    /// 一直失败，退都退不出来。重试是一次新的尝试，重新 prepare 之后要是还有同名文件，
    /// 就再问一次——不会静默地盖掉。
    func retry(_ id: String) {
        guard let index = index(of: id), items[index].message != nil else { return }
        items[index].expectedItemId = nil
        items[index].progress = 0
        items[index].state = .queued
        pump()
    }

    /// 用户不要这一项了：停掉在飞的那一趟，再把它占下的配额放掉。
    ///
    /// 先停后放：反过来的话，那一趟可能正好把那半截对象写完，而那条预留已经不认它了。
    func cancel(_ id: String) async {
        if let task = tasks[id] {
            task.cancel()
            await task.value
        }
        // 被取消的那一趟自己不放会话（见 `run` 里取消那一段），留到这里放：这里不在
        // 取消状态里，请求发得出去。
        if let sessionId = sessions[id] {
            sessions[id] = nil
            await release(sessionId)
        }
        discard(id)
    }

    /// 把一项从列表里拿掉（传完的那一项由调用方在这里收尾）。
    ///
    /// 还在传的走 `cancel(_:)`；这里只收已经不动的项。
    func dismiss(_ id: String) {
        guard tasks[id] == nil else { return }
        discard(id)
    }

    // MARK: - 队列

    /// 有空位就往下放。
    ///
    /// 每一项在 `start` 里**同步**改成 `.uploading`，所以这个循环不会把同一项放两遍。
    private func pump() {
        while running < maxConcurrent, let next = items.first(where: { $0.state == .queued }) {
            start(next.id)
        }
    }

    private func start(_ id: String) {
        guard tasks[id] == nil, let index = index(of: id) else { return }
        items[index].state = .uploading
        running += 1
        tasks[id] = Task { [weak self] in
            await self?.run(id)
            self?.finish(id)
        }
    }

    /// 一趟收工：腾出一个并发位，再看还有没有排队的。
    private func finish(_ id: String) {
        tasks[id] = nil
        running = max(0, running - 1)
        pump()
    }

    // MARK: - 一趟

    private func run(_ id: String) async {
        guard let transport else {
            // `enqueue` 一定装过一套；真没有的话这一项也传不出去，别让它永远停在「上传中」。
            fail(id, DriveText.unknownErrorMessage)
            return
        }
        guard let item = items.first(where: { $0.id == id }) else { return }
        let file = item.file
        let parentId = item.parentId
        let expectedItemId = item.expectedItemId
        // 这一趟的起点。只有在这之后切的后台才算这一趟的失败原因。
        let startedAt = ContinuousClock.now

        let ticket: APIClient.DriveUploadTicket
        do {
            ticket = try await transport.prepare(
                file.name, file.size, file.mimeType, parentId, expectedItemId
            )
        } catch {
            guard !Task.isCancelled else { return }
            fail(id, message(for: error, since: startedAt))
            return
        }
        // 票一到手就登记，**之后**才看取消：`cancel(_:)` 是照 `sessions` 找会话的，先 return
        // 的话这张票再没人知道，而服务端那一步已经建了会话、按声明大小把配额记上了账——
        // 那份预留只能等十五分钟的过期清扫。取消检查与登记之间的顺序是这里唯一要紧的事。
        sessions[id] = ticket.sessionId
        guard !Task.isCancelled else { return }

        // 第一次 prepare（没带覆盖授权）而服务端说目标位置已经有同名文件：先停下来问一句。
        // 它给的那条预留随后作废——确认之后要重新 prepare，这一条用不上了，占着配额不放
        // 就只有等服务端的过期清扫。放掉之前先从 `sessions` 里摘掉，免得 `cancel` 拿着一条
        // 已经放掉的会话再放一次。
        if expectedItemId == nil, let target = ticket.overwrite {
            sessions[id] = nil
            await release(ticket.sessionId)
            guard !Task.isCancelled else { return }
            setState(id, .awaitingOverwrite(target))
            return
        }

        guard let delivered = await transfer(
            id, file: file, first: ticket,
            parentId: parentId, expectedItemId: expectedItemId, startedAt: startedAt
        ) else { return }

        do {
            let uploaded = try await transport.complete(delivered.sessionId)
            // 会话已经变成云盘里那个文件了，`sessions` 里不该再留着它：取消要是正好落在
            // 这一刻，`cancel` 会拿一条已经用掉的会话去放配额（服务端只回一句「上传会话
            // 不存在」，但那条「没放掉」的预警日志是假的）。
            sessions[id] = nil
            guard !Task.isCancelled else { return }
            setState(id, .completed(itemId: uploaded.id))
        } catch {
            guard !Task.isCancelled else { return }
            // 这里留着 `sessions` 不动：complete 被取消时服务端到底收没收到这条请求是不定的，
            // 留给 `cancel` 去试一次，真还活着的那条预留才有机会被放掉。
            await release(delivered.sessionId)
            sessions[id] = nil
            fail(id, message(for: error, since: startedAt))
        }
    }

    /// 把字节 PUT 上去。地址过期（401/403）就重签一次再传，**只重签一次**。
    ///
    /// 上传地址的有效期是 15 分钟，慢网下大文件会过期——那不是失败，是重签一次的事。
    /// 只重签一次是因为：重签之后马上又过期，说明问题不在有效期上，再签多少次都一样，
    /// 而每签一次都会在服务端占一条预留。
    ///
    /// - Returns: 真正把字节送上去的那张票；没送上去就是 nil（失败已经记在那一项上了）。
    private func transfer(
        _ id: String,
        file: PickedFile,
        first: APIClient.DriveUploadTicket,
        parentId: String?,
        expectedItemId: String?,
        startedAt: ContinuousClock.Instant
    ) async -> APIClient.DriveUploadTicket? {
        guard let transport else { return nil }
        var ticket = first
        var resigned = false
        while true {
            do {
                try await transport.put(file.url, ticket.upload.url, ticket.upload.headers) { [weak self] fraction in
                    // 进度从别的线程推过来，回主 actor 再落地。先把弱引用收成一个常量：
                    // 直接在 `Task` 里引用弱捕获的 `self` 是「并发里碰一个可变捕获」。
                    guard let self else { return }
                    Task { @MainActor in self.land(id, fraction) }
                }
                return ticket
            } catch {
                guard !Task.isCancelled else { return nil }
                guard !resigned, Self.isExpiredUploadAddress(error) else {
                    // 同样先摘掉再放（见重签那一段）：`cancel` 不该拿着一条已经放掉的会话
                    // 再放一次。
                    sessions[id] = nil
                    await release(ticket.sessionId)
                    fail(id, message(for: error, since: startedAt))
                    return nil
                }
                resigned = true
                // 这一条预留连地址一起作废了：换一条新的，旧的放掉。先摘掉 `sessions` 再放：
                // 取消要是正好落在这一小段里，`cancel` 不该拿着一条已经放掉的会话再放一次。
                sessions[id] = nil
                await release(ticket.sessionId)
                guard !Task.isCancelled else { return nil }
                do {
                    ticket = try await transport.prepare(
                        file.name, file.size, file.mimeType, parentId, expectedItemId
                    )
                } catch {
                    sessions[id] = nil
                    fail(id, message(for: error, since: startedAt))
                    return nil
                }
                sessions[id] = ticket.sessionId
                // 重签之后**不**再看这张票的 `overwrite`：这一次上传要不要覆盖，第一次
                // prepare 时已经问过了。再问一次会让人把同一件事确认两遍，而按下确认之后
                // 立刻又回到待确认——来回打转。
            }
        }
    }

    /// 进度落进它自己那一行。
    ///
    /// 两条约束都来自同一点：进度是 `URLSession` 的 delegate 从别的线程推过来的，排到
    /// 主 actor 上时这一项可能已经传完、或者已经排进了比它更新的分数。
    /// - 只在真的在传的时候收：传完之后再写一次会把那一行拖回进度条的样子。
    /// - 只往前走：分数本来该是单调的，真乱序了也不该让进度条往回退。
    private func land(_ id: String, _ fraction: Double) {
        guard let index = index(of: id), items[index].state == .uploading else { return }
        items[index].progress = min(max(items[index].progress, fraction), 1)
    }

    /// 一条预留已经不中用了：放掉它占的配额。
    ///
    /// 放不掉只记一笔——用户已经看到失败那句话了，再弹一句「配额没放掉」对他没有用。
    private func release(_ sessionId: String) async {
        guard let transport else { return }
        do {
            try await transport.cancel(sessionId)
        } catch {
            AppLog.drive.warning("drive upload reservation not released: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// 从列表里拿掉，并删掉它留在临时目录里的那份拷贝。
    ///
    /// 那份拷贝是 `DriveFileIntake` 为这一趟上传落的；用户已经跟这一项没关系了，留在盘上
    /// 只是占地方（上限 100 MB 一个）。**失败项不走这里**——它还要重试，文件得留着。
    ///
    /// 只删临时目录里的东西：三个 picker 都落在那里（文件 App 那条路是 `asCopy: true`
    /// 给的拷贝），而这个删除是不可逆的，多一层判断换来的是「绝不动到临时目录之外的
    /// 任何文件」。
    private func discard(_ id: String) {
        guard let index = index(of: id) else { return }
        let url = items[index].file.url
        items.remove(at: index)
        sessions[id] = nil
        guard url.path.hasPrefix(FileManager.default.temporaryDirectory.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - 内部

    /// 失败说给用户听的那句话。
    ///
    /// 这一趟在途中切成后台过，就按「离开 App」说：切后台之后系统会把连接收回去，那不是
    /// 网络问题，报成网络问题会让人去检查 WiFi。
    private func message(for error: Error, since startedAt: ContinuousClock.Instant) -> String {
        if let leftAppAt, leftAppAt >= startedAt { return Self.leftAppMessage }
        return DriveText.errorMessage(error)
    }

    /// 这一条错误说的是「上传地址不认了」。
    ///
    /// `FileUploader` 把 401/403 归成地址过期；对象存储直接拒的时候也可能带自己的 message，
    /// 所以状态码与 code 一起看。
    static func isExpiredUploadAddress(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        return apiError.status == 401 || apiError.status == 403
    }

    /// App 切到后台了。
    ///
    /// 观察者与单测都走这里，所以「离开 App 的那句话」是能在测试里钉住的。
    func noteAppWentToBackground() {
        leftAppAt = ContinuousClock.now
    }

    private func observeBackground() {
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.noteAppWentToBackground() }
        }
    }

    /// 真实的那一套：prepare / complete / cancel 走 `APIClient`，字节走 `FileUploader`。
    private func live(_ client: APIClient) -> DriveUploadTransport {
        let bytes = self.bytes
        return DriveUploadTransport(
            prepare: { name, size, mimeType, parentId, expectedItemId in
                try await client.prepareDriveUpload(
                    name: name,
                    size: size,
                    mimeType: mimeType,
                    parentId: parentId,
                    expectedItemId: expectedItemId
                )
            },
            put: { fileURL, destination, headers, onProgress in
                try await bytes.upload(fileURL: fileURL, to: destination, headers: headers, onProgress: onProgress)
            },
            complete: { sessionId in try await client.completeDriveUpload(sessionId: sessionId) },
            cancel: { sessionId in try await client.cancelDriveUpload(sessionId: sessionId) }
        )
    }

    private func index(of id: String) -> Int? {
        items.firstIndex { $0.id == id }
    }

    private func setState(_ id: String, _ state: DriveUploadItem.State) {
        guard let index = index(of: id) else { return }
        items[index].state = state
    }

    private func fail(_ id: String, _ message: String) {
        setState(id, .failed(message))
    }
}
