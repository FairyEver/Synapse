import Foundation

/// Uploads a local file to an absolute URL, reporting how much has gone.
///
/// Deliberately separate from `APIClient`. The destination is not the Synapse API:
/// it is either a presigned object-storage URL or a one-time token URL, and neither
/// expects the account's bearer token. Reusing `APIClient` here would mean either
/// sending that token to a third party or threading a flag through every one of its
/// request paths to stop it — so the bytes get their own transport.
///
/// Progress is the other reason: it arrives on a delegate, not on the returned
/// value, and the delegate API is per-task rather than per-call.
final class FileUploader: Sendable {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        // A large file on a slow link is not a failure; only a stall is, and the
        // request timeout above is what catches that.
        configuration.timeoutIntervalForResource = 600
        configuration.waitsForConnectivity = true
        session = URLSession(configuration: configuration)
    }

    func upload(
        fileURL: URL,
        to urlString: String,
        headers: [String: String],
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws {
        guard let url = URL(string: urlString) else {
            throw APIError(status: 0, code: "bad_url", message: "上传地址无效。")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.upload(
                for: request,
                fromFile: fileURL,
                delegate: ProgressObserver(onProgress: onProgress)
            )
        } catch {
            throw Self.translate(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "network", message: "上传响应无法读取。")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.decodeError(status: http.statusCode, data: data)
        }
    }

    /// Object storage rejects a bad PUT with its own error shape, so the Synapse
    /// field names are tried first rather than assumed.
    private static func decodeError(status: Int, data: Data) -> APIError {
        struct ErrorBody: Decodable {
            let message: String?
            let error: String?
        }
        if let body = try? JSONDecoder().decode(ErrorBody.self, from: data),
           let message = body.message ?? body.error {
            return APIError(status: status, code: nil, message: message)
        }
        if status == 401 || status == 403 {
            return APIError(status: status, code: "expired", message: "上传地址已过期，请重试。")
        }
        return APIError(status: status, code: nil, message: "上传失败（\(status)）。")
    }

    private static func translate(_ error: Error) -> APIError {
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else {
            return APIError(status: 0, code: "network", message: "上传失败，请稍后重试。")
        }
        if nsError.code == NSURLErrorTimedOut {
            return APIError(status: 0, code: "timeout", message: "上传超时，请检查网络。")
        }
        return APIError(status: 0, code: "network", message: "网络不可用，上传没有完成。")
    }
}

/// Exists only for the length of one upload, which is what lets the progress
/// callback stay per-call instead of keyed by task id on a shared delegate.
private final class ProgressObserver: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        // Zero means the length is not known yet — a chunked body, or the first
        // callback before the size is settled. Reporting a fraction of it would be
        // reporting a number that is not a fraction of anything.
        guard totalBytesExpectedToSend > 0 else { return }
        onProgress(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}
