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

/// 问服务器要这个答案。每次打开资源面板都会重新检查：分享可以被取消或重新启用，
/// 上次的「可访问」或「已失效」不能当作这次的结果。
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

    private let session: URLSession

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
        checkRequest(for: url) != nil
    }

    private static func checkRequest(for url: URL) -> URLRequest? {
        guard SynapseWebLink.isTrusted(url) else { return nil }
        let originPath = AppConfiguration.apiOrigin.path
        let path: String
        if originPath.isEmpty || originPath == "/" {
            path = url.path
        } else {
            path = String(url.path.dropFirst(originPath.count))
        }
        let parts = path.split(separator: "/")

        if parts.first == "share", parts.count >= 2 {
            let itemId: Substring?
            switch parts.count {
            case 2:
                itemId = nil
            case 3 where ["reader", "download", "render"].contains(parts[2]):
                itemId = nil
            case 4 where parts[2] == "items":
                itemId = parts[3]
            case 5 where parts[2] == "items" && ["reader", "download", "render"].contains(parts[4]):
                itemId = parts[3]
            default:
                return nil
            }
            var endpoint = AppConfiguration.apiBaseURL
                .appendingPathComponent("drive")
                .appendingPathComponent("browser")
                .appendingPathComponent("shares")
                .appendingPathComponent(String(parts[1]))
            if let itemId {
                endpoint = endpoint.appendingPathComponent("items").appendingPathComponent(String(itemId))
            }
            var request = URLRequest(url: endpoint)
            request.httpMethod = "GET"
            return request
        }

        guard parts.first == "sites", parts.count >= 2 else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        return request
    }

    func check(_ url: URL) async -> TerminalResourceReachability {
        guard var request = Self.checkRequest(for: url) else { return .unknown }

        // `/share/:id` 是网页入口，失效的 ID 也返回 200 页面壳。分享 API 才校验 ID。
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

        return answer
    }
}
