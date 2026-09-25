import Foundation
import Testing
@testable import SynapseMobile

/// 这一组守两件事。
///
/// 一是**探谁**：校验要替用户发一次请求，范围必须划死在自家服务器的分享链接上 —— 终端正文
/// 里的地址可以是任何东西，替用户去探别的域名既不该做，答案也无从判断（一个 404 的博客文章
/// 和一条坏掉的分享链接不是同一件事）。
///
/// 二是**什么算失效**：只有 404 才算。把 403、5xx、网络故障读成失效，一条好链接会被扣上帽
/// 子，而用户下一次就会开始怀疑这个标记本身 —— 那时候它就不再有用。
final class TerminalResourceReachabilityTests {

    // MARK: - 探谁

    @Test func onesOwnShareLinkIsChecked() {
        #expect(TerminalResourceReachabilityChecker.isCheckable(url("share/shr_abc")))
    }

    @Test func onesOwnSiteLinkIsChecked() {
        #expect(TerminalResourceReachabilityChecker.isCheckable(url("sites/site_abc")))
    }

    /// 同一个域名，但不是分享页：接口、控制台资源、文档都不该被这个 App 探。
    @Test func otherPathsOnTheSameHostAreNotChecked() {
        #expect(!TerminalResourceReachabilityChecker.isCheckable(url("api/drive/items")))
        #expect(!TerminalResourceReachabilityChecker.isCheckable(url("console/synapse-logo.png")))
        #expect(!TerminalResourceReachabilityChecker.isCheckable(url("")))
        // 只是长得像：`/shares/` 是接口路径，`/share` 少一个斜杠。
        #expect(!TerminalResourceReachabilityChecker.isCheckable(url("api/drive/browser/shares/shr_abc")))
        #expect(!TerminalResourceReachabilityChecker.isCheckable(url("share")))
    }

    @Test func anotherHostIsNotChecked() {
        let foreign = URL(string: "https://example.com/share/shr_abc")!
        #expect(!TerminalResourceReachabilityChecker.isCheckable(foreign))
    }

    // MARK: - 什么算失效

    @Test func aGoneLinkIsMissing() async {
        let answer = await checker().check(url("share/shr_missing_abc"))
        #expect(answer == .missing)
    }

    @Test func aLiveLinkIsReachable() async {
        let answer = await checker().check(url("share/shr_ok_abc"))
        #expect(answer == .reachable)
    }

    /// 服务器自己的毛病不是这条链接的毛病。
    @Test func aServerFaultAnswersNothing() async {
        let answer = await checker().check(url("share/shr_boom_abc"))
        #expect(answer == .unknown)
    }

    /// 密码保护、限流之类的拒绝也不是「链接坏了」。
    @Test func aRefusalAnswersNothing() async {
        let answer = await checker().check(url("share/shr_denied_abc"))
        #expect(answer == .unknown)
    }

    /// 别的域名连问都不问，答案自然是「不知道」—— 而不是「失效」。
    @Test func aForeignLinkAnswersNothing() async {
        let answer = await checker().check(URL(string: "https://example.com/share/shr_missing")!)
        #expect(answer == .unknown)
    }

    // MARK: - Fixtures

    /// 当前配置的服务器 —— 换服务器时这组测试跟着走，不写死域名。
    private var host: String { AppConfiguration.apiBaseURL.host ?? "synapse.d2.pub" }

    private func url(_ path: String) -> URL {
        URL(string: "https://\(host)/\(path)")!
    }

    /// 传输层照着路径里的名字回答，所以不需要一份共享的剧本。
    private func checker() -> TerminalResourceReachabilityChecker {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StagedURLProtocol.self]
        return TerminalResourceReachabilityChecker(session: URLSession(configuration: configuration))
    }
}

/// 按路径里的名字回一个状态码：`…missing…` 404，`…denied…` 403，`…boom…` 500，其余 200。
private final class StagedURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let status: Int
        switch true {
        case path.contains("missing"): status = 404
        case path.contains("denied"): status = 403
        case path.contains("boom"): status = 500
        default: status = 200
        }

        guard let url = request.url,
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: status,
                  httpVersion: "HTTP/1.1",
                  headerFields: nil
              )
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
