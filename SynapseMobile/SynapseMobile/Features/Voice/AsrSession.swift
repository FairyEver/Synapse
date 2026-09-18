import Foundation

/// 一次识别要连的东西：桌面签好的地址，和配套的 voiceId。
struct AsrSignature: Equatable {
    /// 已签名的 `wss://` 地址。
    ///
    /// 签名原文只覆盖握手参数、不含音频，所以桌面能预签整条 URL 下发。密钥从来
    /// 没有离开过主进程 —— 手机拿到的只是一次性的入场券。地址不在客户端拼装，
    /// 客户端也不重排它的参数。
    let url: URL
    /// 每次连接都必须换新的；中断之后旧的一律作废。
    let voiceId: String
    /// 签名过期时刻。
    let expiresAt: Date?
}

/// 向服务端要一条签名 URL 的结果。
///
/// 「没连上」和「平台没配语音识别」必须分开：两者的下一步完全不同 —— 等网络回来，
/// 还是等平台把密钥配上 —— 合并成一句话会把人支到错的方向去。
enum AsrSignOutcome {
    case signed(AsrSignature)
    /// 请求没有回音，或者服务端返回了没法用的东西。
    case unreachable
    /// 平台没有配置腾讯云语音识别的密钥。对应服务端的 `VOICE_ASR_NOT_CONFIGURED`。
    case notConfigured
}

/// 一次识别的两级文本。
///
/// 腾讯云的结果按「句」推进，每句有自己的 index 和 slice_type，未定稿的那句**还会
/// 变**。两级分开拿：`stable` 才参与最终提交，`unstable` 只用来显示，而且必须用
/// 次要色 —— 用户眼看着字变了会很难受。
struct AsrTranscript: Equatable {
    /// 已定稿的句子，按 index 顺序拼接。
    let stable: String
    /// 还在变的当前句，排在所有定稿之后。
    let unstable: String

    var combined: String { stable + unstable }
    var isEmpty: Bool { stable.isEmpty && unstable.isEmpty }

    /// 要落进输入框的文本。
    ///
    /// 引擎收尾之后不会再有新的字，所以未定稿的尾巴也一起交出去：那是用户刚说的
    /// 话，丢掉比留着更糟。纯空白按空处理。
    var finalText: String {
        combined.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let empty = AsrTranscript(stable: "", unstable: "")
}

/// 把 slice_type / index / text 三个输入映射成两级文本。
///
/// 纯的：不认识 socket，也不认识时间，所以能被单元测试完整覆盖。
struct AsrTranscriptAccumulator {
    /// slice_type：0 = 这句开始，1 = 识别中（还会变），2 = 定稿。
    static let settledSlice = 2

    private var settled: [Int: String] = [:]
    private var currentIndex: Int?
    private var currentText = ""

    /// 返回这次调用是否真的改变了文本，调用方据此跳过无谓的刷新。
    @discardableResult
    mutating func apply(index: Int, sliceType: Int, text: String) -> Bool {
        if sliceType == Self.settledSlice {
            let changed = settled[index] != text || currentIndex == index
            settled[index] = text
            if currentIndex == index {
                currentIndex = nil
                currentText = ""
            }
            return changed
        }

        // 0 和 1 都不是定稿，都不能写进已定稿的那一半：同一句会因此同时出现在两级
        // 里，「这句开始」的下半截还会再以当前句的身份跟一遍。
        //
        // 反过来，已经定稿的句子也不会被迟到的非稳态结果重开 —— 那同样是同一句
        // 出现在两级里，只是方向反过来。
        guard settled[index] == nil else { return false }

        let changed = currentIndex != index || currentText != text
        currentIndex = index
        currentText = text
        return changed
    }

    func snapshot() -> AsrTranscript {
        // 按 index 排序，与到达顺序无关。
        let stable = settled.keys.sorted().map { settled[$0] ?? "" }.joined()
        return AsrTranscript(stable: stable, unstable: currentIndex == nil ? "" : currentText)
    }

    var isEmpty: Bool { settled.isEmpty && currentText.isEmpty }
}

/// 连腾讯云实时语音识别的 WebSocket。
///
/// URL 由桌面签好带过来，这里不接触任何密钥。音频按 200ms 一包送：比实时快、或两包
/// 间隔超过 6 秒，引擎都会主动断开，所以送包节奏由调用方的定时器保证。
@MainActor
final class AsrSession {
    enum Failure: Equatable {
        /// 连不上，或者中途断了。
        case network
        /// 服务端 code 非 0。
        case server(code: Int, message: String?)
    }

    struct Events {
        /// 连接真的通了，从这一刻起送出去的音频引擎才开始收。
        ///
        /// 握手是异步的：`connect()` 返回时它可能还没连上。轮换的计时起点要的是**引擎
        /// 那边**开始收音频的时刻，早了会把额度算多。
        let onOpen: () -> Void
        let onTranscript: (AsrTranscript) -> Void
        let onFailure: (Failure) -> Void
        /// 引擎确认收尾（`final: 1`），或连接关闭。
        let onFinished: () -> Void
    }

    /// 16k / 16bit / 单声道，200ms 的字节数。一包必须正好这么多。
    static let chunkBytes = 6_400

    private let url: URL
    private let events: Events
    private var task: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?
    private var accumulator = AsrTranscriptAccumulator()
    private var closed = false
    private var finished = false
    private var failureReported = false
    private var opened = false

    init(url: URL, events: Events) {
        self.url = url
        self.events = events
    }

    var transcript: AsrTranscript { accumulator.snapshot() }

    /// 已经断了，或者已经主动关掉。
    var isClosed: Bool { closed || task == nil }

    func connect() {
        guard task == nil, !closed else { return }
        // 一个 URLSession 会把自己和它的 delegate 一直留到 invalidate，所以这里共用
        // 系统的那一个：每录一次音建一个，就是每次录音漏一个。
        let socket = URLSession.shared.webSocketTask(with: url)
        task = socket
        socket.resume()
        receiveLoop = Task { [weak self] in await self?.receive(on: socket) }
    }

    /// 送一包 PCM。连接不在时丢掉：攒下来的包会打乱 200ms 的节奏。
    func send(_ data: Data) {
        guard let task else { return }
        task.send(.data(data)) { _ in }
    }

    /// 告诉引擎音频送完了，等它把最后一句定稿回来。
    func finish() {
        guard let task else { return }
        task.send(.string(#"{"type":"end"}"#)) { _ in }
    }

    /// 直接断，不等收尾。取消和收尾超时都走这里。
    func close() {
        closed = true
        receiveLoop?.cancel()
        receiveLoop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    // MARK: - Socket

    private func receive(on socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                handle(try await socket.receive())
            } catch {
                // 没走到 final 就断了，对用户来说就是「网络已断开」，不是正常结束。
                if !closed, !finished { reportFailure(.network) }
                events.onFinished()
                close()
                return
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let raw): data = raw
        @unknown default: return
        }
        guard let message = try? JSONDecoder().decode(ServerMessage.self, from: data) else { return }
        reportOpen()

        if let code = message.code, code != 0 {
            reportFailure(.server(code: code, message: message.message))
            close()
            return
        }

        if let result = message.result, let text = result.text {
            let changed = accumulator.apply(
                index: result.index ?? 0,
                // 缺 slice_type 的一律当定稿：宁可把它算成结果，也不能让它以当前句
                // 的身份永远留在那儿。
                sliceType: result.sliceType ?? AsrTranscriptAccumulator.settledSlice,
                text: text
            )
            if changed { events.onTranscript(accumulator.snapshot()) }
        }

        if message.final == 1 {
            finished = true
            events.onFinished()
        }
    }

    /// 只报一次。轮换的计时起点是它，重复报会把连接年龄算小，等于往后拖接棒。
    private func reportOpen() {
        guard !opened, !closed else { return }
        opened = true
        events.onOpen()
    }

    private func reportFailure(_ failure: Failure) {
        guard !failureReported, !closed else { return }
        failureReported = true
        events.onFailure(failure)
    }

    /// 服务端的一帧。字段名是腾讯云的，认不出的一律当没有。
    private struct ServerMessage: Decodable {
        let code: Int?
        let final: Int?
        let message: String?
        let result: Result?

        struct Result: Decodable {
            let sliceType: Int?
            let index: Int?
            let text: String?

            private enum CodingKeys: String, CodingKey {
                case sliceType = "slice_type"
                case index
                case text = "voice_text_str"
            }
        }
    }
}
