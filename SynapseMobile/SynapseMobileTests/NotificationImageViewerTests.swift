import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct NotificationImageViewerTests {
    @Test func aFailedLoadCanBeRetried() async {
        var attempts = 0
        let model = NotificationImageViewerModel(notificationId: "n1", loader: {
            attempts += 1
            if attempts == 1 { throw APIError(status: 0, code: "network", message: "网络不可用") }
            return URL(fileURLWithPath: "/tmp/does-not-matter.png")
        }, saver: StubSaver(result: .success(())))
        await model.load()
        #expect(model.state == .failed)
        await model.load()
        #expect(model.state == .loaded(URL(fileURLWithPath: "/tmp/does-not-matter.png")))
        #expect(attempts == 2)
    }

    @Test func aDeniedSaveKeepsTheImageVisibleAndExplains() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let model = NotificationImageViewerModel(notificationId: "n1", loader: { url }, saver: StubSaver(result: .failure(.denied)))
        await model.load()
        await model.save()
        #expect(model.state == .loaded(url))
        #expect(model.notice == "没有相册写入权限")
    }

    @Test func savingUsesTheDownloadedOriginalFile() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let saver = CapturingSaver()
        let model = NotificationImageViewerModel(notificationId: "n1", loader: { url }, saver: saver)
        await model.load()
        await model.save()
        #expect(saver.savedURLs == [url])
    }
}

private final class CapturingSaver: PhotoLibrarySaving {
    private(set) var savedURLs: [URL] = []
    func save(originalFile: URL) async throws { savedURLs.append(originalFile) }
}

private struct StubSaver: PhotoLibrarySaving {
    let result: Result<Void, PhotoLibrarySaveError>
    func save(originalFile: URL) async throws { try result.get() }
}
