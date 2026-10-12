import Foundation
import Testing
@testable import SynapseMobile

final class TodoTestTransport: @unchecked Sendable {
    enum Reply {
        case json(Int, String)
        case failure(URLError.Code)
        case held
    }
    struct Request {
        let method: String
        let url: URL
        let body: Data?
        let cachePolicy: URLRequest.CachePolicy
    }
    private let lock = NSLock()
    private var replies: [Reply] = []
    private var captured: [Request] = []
    private var held: [Int: TodoTestURLProtocol] = [:]

    var requests: [Request] {
        lock.lock(); defer { lock.unlock() }
        return captured
    }
    func enqueue(_ replies: Reply...) {
        lock.lock(); defer { lock.unlock() }
        self.replies.append(contentsOf: replies)
    }
    func receive(_ connection: TodoTestURLProtocol) {
        guard let url = connection.request.url else { return }
        if url.lastPathComponent == "refresh" || url.lastPathComponent == "login" {
            connection.finish(status: 200, body: #"{"accessToken":"todo-access","refreshToken":"todo-refresh"}"#)
            return
        }
        if url.lastPathComponent == "logout" {
            connection.finish(status: 200, body: "{}")
            return
        }
        let body = connection.bodyData()
        lock.lock()
        let index = captured.count
        captured.append(Request(method: connection.request.httpMethod ?? "GET", url: url, body: body, cachePolicy: connection.request.cachePolicy))
        let reply = replies.isEmpty ? Reply.failure(.unsupportedURL) : replies.removeFirst()
        if case .held = reply { held[index] = connection }
        lock.unlock()
        switch reply {
        case .json(let status, let body): connection.finish(status: status, body: body)
        case .failure(let code): connection.fail(code)
        case .held: break
        }
    }
    func finish(_ index: Int, status: Int = 200, body: String) {
        lock.lock()
        let connection = held.removeValue(forKey: index)
        lock.unlock()
        connection?.finish(status: status, body: body)
    }
}

final class TodoTestURLProtocol: URLProtocol {
    private final class Registry: @unchecked Sendable {
        private let lock = NSLock()
        private var transports: [String: TodoTestTransport] = [:]
        func register(_ transport: TodoTestTransport, id: String) {
            lock.lock(); defer { lock.unlock() }
            transports[id] = transport
        }
        func unregister(_ id: String) {
            lock.lock(); defer { lock.unlock() }
            transports.removeValue(forKey: id)
        }
        func find(_ id: String) -> TodoTestTransport? {
            lock.lock(); defer { lock.unlock() }
            return transports[id]
        }
    }
    private static let registry = Registry()
    static func register(_ transport: TodoTestTransport, id: String) { registry.register(transport, id: id) }
    static func unregister(_ id: String) { registry.unregister(id) }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let id = request.value(forHTTPHeaderField: "X-Todo-Test-ID"), let transport = Self.registry.find(id) else {
            fail(.unsupportedURL)
            return
        }
        transport.receive(self)
    }
    override func stopLoading() {}
    func fail(_ code: URLError.Code) { client?.urlProtocol(self, didFailWithError: URLError(code)) }
    func finish(status: Int, body: String) {
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    func bodyData() -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }
}

struct TodoTestFixture {
    let identifier = UUID().uuidString
    let transport = TodoTestTransport()
    let tokens: TokenStore
    let session: URLSession
    let api: APIClient
    init() {
        tokens = TokenStore(service: "com.liy.SynapseMobile.tests.todos.\(identifier)")
        tokens.refreshToken = "todo-refresh"
        TodoTestURLProtocol.register(transport, id: identifier)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TodoTestURLProtocol.self]
        configuration.httpAdditionalHeaders = ["X-Todo-Test-ID": identifier]
        session = URLSession(configuration: configuration)
        api = APIClient(tokens: tokens, session: session, onCredentialsChanged: {})
    }
    func clear() {
        tokens.clearCredentials()
        session.invalidateAndCancel()
        TodoTestURLProtocol.unregister(identifier)
    }
    func waitForRequests(_ count: Int) async -> Bool {
        let deadline = Date().addingTimeInterval(3)
        while transport.requests.count < count, Date() < deadline { await Task.yield() }
        return transport.requests.count >= count
    }
    static func itemJSON(id: String = "todo_1", version: Int = 1, completed: Bool = false) -> String {
        """
        {"id":"\(id)","title":"报告","note":null,"dueAt":"2026-11-12T09:00:00.000Z",
        "reminder":"at_due","offsetMinutes":null,"remindAt":"2026-11-12T09:00:00.000Z",
        "reminderGeneration":1,"reminderStatus":"\(completed ? "cancelled" : "pending")",
        "completedAt":\(completed ? "\"2026-10-11T09:00:00.000Z\"" : "null"),
        "version":\(version),"createdAt":"2026-10-11T08:00:00.000Z","updatedAt":"2026-10-11T09:00:00.000Z"}
        """
    }
    static func pageJSON(_ items: [String], nextOffset: Int? = nil) -> String {
        "{\"items\":[\(items.joined(separator: ","))],\"nextOffset\":\(nextOffset.map(String.init) ?? "null")}"
    }
    static func item(id: String = "todo_1", version: Int = 1, completed: Bool = false) throws -> TodoItemDto {
        try JSONDecoder().decode(TodoItemDto.self, from: Data(itemJSON(id: id, version: version, completed: completed).utf8))
    }
}
