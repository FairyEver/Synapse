import Foundation
import Photos
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
        }, saver: StubSaver(result: .success(())), cache: NotificationImageCache())
        await model.load()
        #expect(model.state == .failed)
        await model.load()
        #expect(model.state == .loaded(URL(fileURLWithPath: "/tmp/does-not-matter.png")))
        #expect(attempts == 2)
    }

    @Test func aDeniedSaveKeepsTheImageVisibleAndOffersSettings() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        var openedSettings = false
        let model = NotificationImageViewerModel(
            notificationId: "n1",
            loader: { url },
            saver: StubSaver(result: .failure(.denied)),
            cache: NotificationImageCache(),
            openSettings: { openedSettings = true }
        )
        await model.load()
        await model.save()
        #expect(model.state == .loaded(url))
        #expect(model.notice == "没有相册写入权限")
        #expect(model.noticeOffersSettings)

        model.openNotificationSettings()
        #expect(openedSettings)
        #expect(model.notice == nil)
        #expect(!model.noticeOffersSettings)
    }

    @Test func aDeniedAuthorizationNeverWritesToPhotos() async {
        let saver = PhotoLibrarySaver(
            requestAuthorization: { .denied },
            performSave: { _ in Issue.record("must not attempt to write") }
        )
        await #expect(throws: PhotoLibrarySaveError.denied) {
            try await saver.save(originalFile: URL(fileURLWithPath: "/tmp/x.png"))
        }
    }

    @Test func aFailedSaveReportsFailureWithoutDroppingTheImage() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let model = NotificationImageViewerModel(
            notificationId: "n1", loader: { url }, saver: StubSaver(result: .failure(.failed)),
            cache: NotificationImageCache()
        )
        await model.load()
        await model.save()
        #expect(model.notice == "保存失败")
        #expect(!model.noticeOffersSettings)
        #expect(model.state == .loaded(url))
    }

    @Test func savingUsesTheDownloadedOriginalFile() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let saver = CapturingSaver()
        let model = NotificationImageViewerModel(
            notificationId: "n1", loader: { url }, saver: saver, cache: NotificationImageCache()
        )
        await model.load()
        await model.save()
        #expect(saver.savedURLs == [url])
    }

    @Test func aSecondSaveTapWhileOneIsRunningWritesOnlyOneAsset() async {
        let url = URL(fileURLWithPath: "/tmp/x.png")
        let saver = SlowSaver()
        let model = NotificationImageViewerModel(
            notificationId: "n1", loader: { url }, saver: saver, cache: NotificationImageCache()
        )
        await model.load()
        async let first: Void = model.save()
        while saver.calls == 0 { await Task.yield() }
        #expect(model.isSaving)
        await model.save()
        await saver.finish()
        await first
        #expect(saver.calls == 1)
    }

    @Test func reopeningTheSameNotificationReusesTheCachedImage() async {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent("notification-source-\(UUID().uuidString).png")
        try? imageData.write(to: source)
        let cache = NotificationImageCache()
        var downloads = 0
        let first = NotificationImageViewerModel(
            notificationId: "n1",
            loader: { downloads += 1; return source },
            saver: StubSaver(result: .success(())),
            cache: cache
        )
        await first.load()
        let second = NotificationImageViewerModel(
            notificationId: "n1",
            loader: { downloads += 1; return source },
            saver: StubSaver(result: .success(())),
            cache: cache
        )
        await second.load()
        #expect(downloads == 1)
        #expect(second.state != .failed)
        first.discardTemporaryFile()
        second.discardTemporaryFile()
    }

    @Test func closingTheViewerDeletesItsTemporaryFile() async {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent("notification-source-\(UUID().uuidString).png")
        try? imageData.write(to: source)
        let model = NotificationImageViewerModel(
            notificationId: "n1",
            loader: { source },
            saver: StubSaver(result: .success(())),
            cache: NotificationImageCache()
        )
        await model.load()
        guard case .loaded(let url) = model.state else {
            Issue.record("expected a loaded image")
            return
        }
        #expect(FileManager.default.fileExists(atPath: url.path))
        model.discardTemporaryFile()
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }

    @Test func aSuccessfulSaveDeletesTheTemporaryFileAfterWriting() async {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent("notification-source-\(UUID().uuidString).png")
        try? imageData.write(to: source)
        let saver = CapturingSaver()
        let model = NotificationImageViewerModel(
            notificationId: "n1", loader: { source }, saver: saver, cache: NotificationImageCache()
        )
        await model.load()
        guard case .loaded(let url) = model.state else {
            Issue.record("expected a loaded image")
            return
        }
        await model.save()
        #expect(model.notice == "已保存到相册")
        #expect(saver.savedURLs == [url])
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }

    @Test func oneToOneScaleMapsImagePixelsOntoViewPoints() {
        #expect(NotificationImageViewZoom.oneToOneScale(imagePixelWidth: 2048, viewWidth: 1024) == 2)
        #expect(NotificationImageViewZoom.oneToOneScale(imagePixelWidth: 1024, viewWidth: 1024) == 1)
        #expect(NotificationImageViewZoom.oneToOneScale(imagePixelWidth: 0, viewWidth: 0) == 1)
    }

    private var imageData: Data {
        Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
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

/// 第一次保存停在半路，用来证明第二次点按被 `isSaving` 挡住。
private final class SlowSaver: PhotoLibrarySaving, @unchecked Sendable {
    private let lock = NSLock()
    private var storedCalls = 0
    private var continuation: CheckedContinuation<Void, Never>?

    var calls: Int { lock.withLock { storedCalls } }

    func save(originalFile: URL) async throws {
        lock.withLock { storedCalls += 1 }
        await withCheckedContinuation { continuation in
            lock.withLock { self.continuation = continuation }
        }
    }

    func finish() async {
        while true {
            let pending: CheckedContinuation<Void, Never>? = lock.withLock {
                defer { continuation = nil }
                return continuation
            }
            if let pending {
                pending.resume()
                return
            }
            await Task.yield()
        }
    }
}
