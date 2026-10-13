import Foundation
import Observation

enum DriveBrowserShareLink {
    /// 只把本人云盘的完整条目地址交给分享接口；公开分享和其他网页沿用当前地址。
    static func ownerItemID(in url: URL, origin: URL) throws -> String? {
        guard SynapseWebLink.isTrusted(url, origin: origin) else { return nil }
        let path = relativeEncodedPath(url, origin: origin)
        for prefix in ["/drive/items", "/console/drive/items"] {
            guard path == prefix || path.hasPrefix(prefix + "/") else { continue }
            guard url.user == nil, url.password == nil,
                  path.hasPrefix(prefix + "/"),
                  let id = String(path.dropFirst(prefix.count + 1)).removingPercentEncoding,
                  !id.isEmpty, id != ".", id != "..",
                  !id.contains(where: { "/\\%?#".contains($0) || $0.isWhitespace || $0.isNewline || $0.asciiValue == 0 })
            else { throw invalidLink() }
            return id
        }
        return nil
    }

    static func publicURL(for share: DriveShare, itemId: String, origin: URL) throws -> URL {
        let address = share.passwordEnabled ? share.urlWithPassword : share.url
        guard share.itemId == itemId, share.isActive(),
              let url = URL(string: address), SynapseWebLink.isTrusted(url, origin: origin),
              relativeEncodedPath(url, origin: origin).removingPercentEncoding == "/share/\(share.shareId)",
              url.user == nil, url.password == nil
        else { throw invalidLink() }
        if share.passwordEnabled {
            guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .contains(where: { $0.name == "password" && $0.value?.isEmpty == false }) == true
            else { throw invalidLink() }
        }
        return url
    }

    private static func relativeEncodedPath(_ url: URL, origin: URL) -> String {
        let prefix = origin.path(percentEncoded: true).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let path = url.path(percentEncoded: true)
        return prefix.isEmpty ? path : String(path.dropFirst(prefix.count + 1))
    }

    private static func invalidLink() -> APIError {
        APIError(status: 400, code: "invalid_share_link", message: "无法生成分享链接，请重试。")
    }
}

@MainActor
@Observable
final class DriveBrowserShareState {
    var target: WebLink?
    private(set) var isPreparing = false
    private(set) var errorMessage: String?
    @ObservationIgnored private var requestID = UUID()
    @ObservationIgnored private var task: Task<Void, Never>?

    @discardableResult
    func start(
        url: URL, origin: URL, isCurrent: @escaping () -> Bool,
        createShare: @escaping (String) async throws -> DriveShare,
        onShared: @escaping () async -> Void
    ) -> Task<Void, Never>? {
        guard !isPreparing, target == nil, isCurrent(), !Task.isCancelled else { return nil }
        // 同步占用这一趟请求，第二次点击不能在 Task 开始前覆盖取消句柄。
        let request = UUID()
        requestID = request
        isPreparing = true
        errorMessage = nil
        let pending = Task {
            defer {
                if requestID == request {
                    isPreparing = false
                    task = nil
                }
            }
            await prepare(request: request, url: url, origin: origin, isCurrent: isCurrent, createShare: createShare)
            guard requestID == request, target != nil, isCurrent(), !Task.isCancelled else { return }
            await onShared()
        }
        task = pending
        return pending
    }

    private func prepare(
        request: UUID,
        url: URL,
        origin: URL,
        isCurrent: () -> Bool,
        createShare: (String) async throws -> DriveShare
    ) async {
        guard requestID == request, isCurrent(), !Task.isCancelled else { return }
        do {
            let shareURL: URL
            if let itemId = try DriveBrowserShareLink.ownerItemID(in: url, origin: origin) {
                let share = try await createShare(itemId)
                guard requestID == request, isCurrent(), !Task.isCancelled else { return }
                shareURL = try DriveBrowserShareLink.publicURL(for: share, itemId: itemId, origin: origin)
            } else {
                shareURL = url
            }
            guard requestID == request, isCurrent(), !Task.isCancelled else { return }
            target = WebLink(url: shareURL)
        } catch {
            guard requestID == request, isCurrent(),
                  !DriveRequestCancellation.covers(error, taskCancelled: Task.isCancelled) else { return }
            errorMessage = DriveText.errorMessage(error)
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        requestID = UUID()
        isPreparing = false
        target = nil
        errorMessage = nil
    }

    func dismissError() {
        errorMessage = nil
    }
}
