import Foundation

/// 一条会话资源现在还打不开得开。
///
/// 资源列表里的地址是从终端正文里读出来的，而正文可能本来就是坏的。一条分享 id 有三十
/// 多个字符，模型复述它的时候少抄一个，服务器就只剩 404 —— 库里那条链接一直是好的，落到
/// 用户手上的那条却是死的。这不是假设：`shr_0VcnIOa08…` 被复述成 `shr_0VcnIOa8…`，少掉
/// 的那一位让分享页回「链接已失效」，而资源列表当时把它当成一条普通链接列了出来。这里在
/// 打开之前先问一次服务器，把「点了才发现打不开」变成「一眼看得见」。
///
/// 三态而不是布尔，判据和 `TerminalOpenability` 是同一条：**只有服务器亲口说的 404 才算
/// 失效**。网络不通、超时、401/403/5xx 都是「不知道」—— 把不知道说成失效，一条好链接会
/// 被扣上帽子，而用户下一次就会开始怀疑这个标记本身。标记一旦不可信，它就不再有用。
enum TerminalResourceReachability: Equatable {
    /// 服务器说它在。
    case reachable
    /// 服务器说它不在：404。链接本身是坏的，或者这份分享已经被撤了。
    case missing
    /// 还没问，或者问到的答案不是这两个之一。
    case unknown
}

/// 问服务器要这个答案，并记住问过的。
///
/// 只缓存**确定的答案**（在 / 不在）。`unknown` 不留：它多半是网络一时的状态，记下来只会
/// 让下一次打开面板继续显示同一个「不知道」。
actor TerminalResourceReachabilityChecker {
    static let shared = TerminalResourceReachabilityChecker()

    /// 一次面板里最多同时问几条。
    ///
    /// 资源列表通常只有一两条，这个上限是防着一屏几十条链接的情况 —— 那会是一屏的并发连接，
    /// 而它们换来的只是列表上的一行小字。
    static let maximumConcurrentChecks = 3

    /// 校验一次的上限。
    ///
    /// 比 `AppConfiguration.requestTimeout` 短：这是顺手做的一件事，一次校验卡住二十秒，
    /// 整张列表的标记都会停在没有标记的样子上。
    static let checkTimeout: TimeInterval = 10

    /// 记住的答案条数上限。
    ///
    /// 一个会话的资源通常只有个位数，但会话是长跑的（`tail -f` 能刷出很多链接），而这是
    /// App 生命周期内的缓存，得有个头。到顶就整张丢掉：它的价值在最近打开的那个面板上，
    /// 不在历史里。
    private let answerLimit = 200

    private let session: URLSession
    private var answers: [String: TerminalResourceReachability] = [:]

    /// 传输层可换，好让测试把答案编排出来 —— 状态码到三态的映射正是这里唯一会判错的
    /// 一步，而它错起来的方向很难看：把 403 读成失效，用户会开始怀疑这个标记本身。
    init(session: URLSession = TerminalResourceReachabilityChecker.makeSession()) {
        self.session = session
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = checkTimeout
        configuration.timeoutIntervalForResource = checkTimeout
        // 连不上就当场算数：`waitsForConnectivity` 会让一次没有路径的请求一直等下去，
        // 而这里要的只是一个当下能不能打开的答案。
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }

    /// 只问自己服务器上的分享链接。
    ///
    /// 终端正文里的链接可以是任何地址，而这里要替用户发一次请求。范围划在「本机配置的
    /// 服务器 + 分享路径」上：别的域名既不该被这个 App 去探，答案也无从判断 —— 一个 404
    /// 的博客文章和一条坏掉的分享链接不是同一件事。
    static func isCheckable(_ url: URL) -> Bool {
        guard let host = url.host, host == AppConfiguration.apiBaseURL.host else { return false }
        return url.path.hasPrefix("/share/") || url.path.hasPrefix("/sites/")
    }

    func check(_ url: URL) async -> TerminalResourceReachability {
        guard Self.isCheckable(url) else { return .unknown }
        if let answer = answers[url.absoluteString] { return answer }

        var request = URLRequest(url: url)
        // 只要状态码，不要页面。分享页是整页 HTML，而 HEAD 拿到的状态码和 GET 一样。
        request.httpMethod = "HEAD"
        request.timeoutInterval = Self.checkTimeout
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let answer: TerminalResourceReachability
        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .unknown }
            switch http.statusCode {
            case 200..<400:
                answer = .reachable
            case 404:
                answer = .missing
            default:
                // 405（服务器不收 HEAD）、401/403（要密码）、5xx（服务器自己的事）都不是
                // 「这条链接坏了」。留着 unknown，不替服务器下结论。
                return .unknown
            }
        } catch {
            return .unknown
        }

        if answers.count >= answerLimit { answers.removeAll() }
        answers[url.absoluteString] = answer
        return answer
    }
}
