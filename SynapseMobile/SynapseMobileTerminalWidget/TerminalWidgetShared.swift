import AppIntents
import Foundation

/// Only display data crosses into the widget extension. Credentials and terminal
/// control never enter the shared container.
nonisolated struct TerminalWidgetSession: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let status: String
    let attentionState: String
    let attentionKind: String
    let cwd: String
    let lastLine: String

    var needsAttention: Bool { attentionState == "waiting" }
    var isRunning: Bool { status == "running" }
}

nonisolated struct TerminalWidgetSnapshot: Codable, Equatable {
    let capturedAt: Date
    let desktopId: String
    let desktopName: String
    let isOnline: Bool
    let sessions: [TerminalWidgetSession]

    func session(for entity: TerminalWidgetSessionEntity?) -> TerminalWidgetSession? {
        guard let entity else { return nil }
        return sessions.first { TerminalWidgetSessionEntity.id(desktopId: desktopId, sessionId: $0.id) == entity.id }
    }
}

nonisolated enum TerminalWidgetShared {
    static let groupId = "group.com.liy.SynapseMobile"
    static let widgetKind = "com.liy.SynapseMobile.Terminal"
    static let staleInterval: TimeInterval = 15 * 60
    private static let fileName = "terminal-widget-snapshot.json"

    static func load() -> TerminalWidgetSnapshot? {
        guard let url = snapshotURL(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(TerminalWidgetSnapshot.self, from: data)
    }

    static func save(_ snapshot: TerminalWidgetSnapshot) throws {
        guard let url = snapshotURL() else { throw StoreError.groupUnavailable }
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    static func clear() throws {
        guard let url = snapshotURL() else { throw StoreError.groupUnavailable }
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    private static func snapshotURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId)?
            .appendingPathComponent(fileName)
    }

    enum StoreError: Error { case groupUnavailable }
}

struct TerminalWidgetSessionEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "终端会话"
    static var defaultQuery = TerminalWidgetSessionQuery()

    let id: String
    let title: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

    nonisolated static func id(desktopId: String, sessionId: String) -> String {
        "\(desktopId):\(sessionId)"
    }
}

struct TerminalWidgetSessionQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [TerminalWidgetSessionEntity] {
        try await suggestedEntities().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [TerminalWidgetSessionEntity] {
        guard let snapshot = TerminalWidgetShared.load() else { return [] }
        return snapshot.sessions.map {
            TerminalWidgetSessionEntity(
                id: TerminalWidgetSessionEntity.id(desktopId: snapshot.desktopId, sessionId: $0.id),
                title: $0.title
            )
        }
    }
}

struct TerminalWidgetConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "终端"
    static var description = IntentDescription("查看终端状态")

    @Parameter(title: "监看的会话") var session: TerminalWidgetSessionEntity?
    @Parameter(title: "显示最近输出", default: false) var showsLastLine: Bool
}

enum TerminalWidgetLink {
    struct Target: Equatable {
        let desktopId: String?
        let sessionId: String?
    }

    static func url(desktopId: String?, sessionId: String?) -> URL? {
        var components = URLComponents()
        components.scheme = "synapse"
        components.host = "terminal"
        components.queryItems = [
            desktopId.map { URLQueryItem(name: "desktop", value: $0) },
            sessionId.map { URLQueryItem(name: "session", value: $0) },
        ].compactMap { $0 }
        return components.url
    }

    static func target(from url: URL) -> Target? {
        guard url.scheme == "synapse", url.host() == "terminal" else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let desktopId = components?.queryItems?.first { $0.name == "desktop" }?.value
        let sessionId = components?.queryItems?.first { $0.name == "session" }?.value
        guard sessionId == nil || desktopId != nil else { return nil }
        return Target(desktopId: desktopId, sessionId: sessionId)
    }
}
