import Foundation

nonisolated enum TodoNetworkPolicy {
    static func configuration(requestTimeout: TimeInterval, resourceTimeout: TimeInterval,
                              inheriting transport: URLSessionConfiguration? = nil) -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeout
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.waitsForConnectivity = false
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        if let transport {
            configuration.protocolClasses = transport.protocolClasses
            configuration.httpAdditionalHeaders = transport.httpAdditionalHeaders
        }
        return configuration
    }
}
