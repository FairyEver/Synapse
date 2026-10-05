import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct LinkBrowserCookieLifecycleTests {
    @Test func logoutWaitsForAnAlreadyStartedWriteThenClearsIt() async {
        let memory = CookieMemory(suspendFirstWrite: true)
        let store = memory.store()
        let installing = Task {
            try await store.install(cookies(token: "old"), matching: { _ in true }, isCurrent: { true })
        }
        await memory.waitForWrite()
        let clearing = Task { await store.clear(matching: { _ in true }) }
        // Both run on MainActor: give clear its turn to invalidate the installation
        // while the first WebKit completion is still held by CookieMemory.
        await Task.yield()
        memory.completeWrite()
        await clearing.value
        do {
            try await installing.value
            Issue.record("An installation invalidated by logout must not finish successfully")
        } catch {
            #expect(error is CancellationError)
        }
        #expect(memory.cookies.isEmpty)
        #expect(memory.writtenPaths == ["/api"])
    }

    @Test func aLateAuthorizationCannotReplaceTheCurrentAccountsCookies() async throws {
        let memory = CookieMemory()
        memory.cookies = cookies(token: "current")
        let store = memory.store()
        do {
            try await store.install(cookies(token: "old"), matching: { _ in true }, isCurrent: { false })
            Issue.record("Authorization from a departed account must be rejected")
        } catch {
            #expect(error is CancellationError)
        }
        #expect(memory.cookies.map(\.value) == ["current", "current"])
        #expect(memory.writtenPaths.isEmpty)
    }

    @Test func anAccountChangeDuringCookieWriteStopsTheSecondPath() async {
        let memory = CookieMemory(suspendFirstWrite: true)
        let store = memory.store()
        var accountIsCurrent = true
        let installing = Task {
            try await store.install(cookies(token: "old"), matching: { _ in true }, isCurrent: { accountIsCurrent })
        }
        await memory.waitForWrite()
        accountIsCurrent = false
        memory.completeWrite()
        do {
            try await installing.value
            Issue.record("An account change during a write must invalidate authorization")
        } catch {
            #expect(error is CancellationError)
        }
        await store.clear(matching: { _ in true })
        #expect(memory.writtenPaths == ["/api"])
        #expect(memory.cookies.isEmpty)
    }

    private func cookies(token: String) -> [HTTPCookie] {
        ["/api", "/drive"].map { path in
            HTTPCookie(properties: [
                .name: "synapse_user_session", .value: token, .domain: "example.invalid", .path: path,
            ])!
        }
    }
}

@MainActor
private final class CookieMemory {
    var cookies: [HTTPCookie] = []
    private(set) var writtenPaths: [String] = []
    private var suspendFirstWrite: Bool
    private var writeCompletion: CheckedContinuation<Void, Never>?
    private var writeStarted: CheckedContinuation<Void, Never>?

    init(suspendFirstWrite: Bool = false) { self.suspendFirstWrite = suspendFirstWrite }

    func store() -> SynapseWebCookieStore {
        SynapseWebCookieStore(
            read: { self.cookies },
            write: { cookie in
                self.writtenPaths.append(cookie.path)
                if self.suspendFirstWrite {
                    self.suspendFirstWrite = false
                    await withCheckedContinuation { completion in
                        self.writeCompletion = completion
                        self.writeStarted?.resume()
                        self.writeStarted = nil
                    }
                }
                self.cookies.removeAll { $0.name == cookie.name && $0.path == cookie.path }
                self.cookies.append(cookie)
            },
            remove: { cookie in self.cookies.removeAll { $0.name == cookie.name && $0.path == cookie.path } }
        )
    }

    func waitForWrite() async {
        if writeCompletion != nil { return }
        await withCheckedContinuation { writeStarted = $0 }
    }

    func completeWrite() {
        writeCompletion?.resume()
        writeCompletion = nil
    }
}
