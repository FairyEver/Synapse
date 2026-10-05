import Foundation

nonisolated enum WorkspaceFilesScopeMode: String, Codable, Sendable { case currentDirectory, repository }
nonisolated enum WorkspaceFilesChangeRange: String, Codable, Sendable { case unstaged, staged }
nonisolated enum WorkspaceFilesOperation: String, Codable, Sendable {
    case open, refresh, directory, search, changes, diff, preview, reference, cancel, close
}

nonisolated struct WorkspaceFilesPreviewTarget: Encodable, Sendable {
    let source: String
    var entryId: String?
    var changeId: String?
    var changeSetVersion: String?
    var side: String?
}

/// Mirrors the private, bounded workspace-files wire contract. Optional fields belong
/// to different operation data; validation checks the selected operation before use.
nonisolated struct WorkspaceFilesResult: Decodable, Sendable {
    let filesVersion: Int
    let operation: WorkspaceFilesOperation
    let sessionId: String
    let scopeId: String?
    let contextVersion: String?
    let readAt: String
    let data: WorkspaceFilesData
}

nonisolated struct WorkspaceFilesData: Decodable, Sendable {
    var scopeId: String?
    var rootEntryId: String?
    var scopeMode: WorkspaceFilesScopeMode?
    var rootDisplayName: String?
    var contextVersion: String?
    var expiresAt: String?
    var gitAvailable: Bool?
    var gitUnavailableReason: String?
    var directoryVersion: String?
    var searchVersion: String?
    var changeSetVersion: String?
    var contentVersion: String?
    var entries: [WorkspaceFileEntry]?
    var hunks: [WorkspaceFileHunk]?
    var lines: [WorkspacePreviewLine]?
    var text: String?
    var source: String?
    var side: String?
    var name: String?
    var relativePath: String?
    var language: String?
    var contentState: String?
    var truncatedReason: String?
    var format: String?
    var changeRange: WorkspaceFilesChangeRange?
    var changeId: String?
    var metadata: WorkspaceFilesMetadata?
    var nextCursor: String?
    var pageIndex: Int?
    var completion: String?
    var collectionComplete: Bool?
    var statsComplete: Bool?
    var contentComplete: Bool?
    var scanComplete: Bool?
    var scannedEntries: Int?
    var ranges: WorkspaceFilesSummaries?
    var additions: Int?
    var deletions: Int?
    var referenceText: String?
    var status: String?
    var pendingCancellationCount: Int?
}

nonisolated struct WorkspaceFilesSummaries: Decodable, Sendable {
    let unstaged: WorkspaceFilesSummary
    let staged: WorkspaceFilesSummary
}
nonisolated struct WorkspaceFilesSummary: Decodable, Sendable {
    var fileCount: Int?
    var additions: Int?
    var deletions: Int?
    var collectionComplete: Bool?
    var statsComplete: Bool?
}
nonisolated struct WorkspaceFileEntry: Decodable, Identifiable, Hashable, Sendable {
    var entryId: String?
    var changeId: String?
    var name: String { displayName ?? (relativePath as NSString).lastPathComponent }
    var displayName: String?
    let relativePath: String
    var kind: String?
    var status: String?
    var oldRelativePath: String?
    var oldGitlink: String?
    var newGitlink: String?
    var additions: Int?
    var deletions: Int?
    var statsComplete: Bool?
    var contentState: String?
    var unavailableReason: String?
    var canPreview: Bool?
    var canPreviewBefore: Bool?
    var canPreviewAfter: Bool?
    var changeRange: WorkspaceFilesChangeRange?
    var metadata: WorkspaceFilesMetadata?
    var canReference: Bool?
    enum CodingKeys: String, CodingKey {
        case entryId, changeId, displayName = "name", relativePath, kind, status, oldRelativePath, oldGitlink, newGitlink
        case additions, deletions, statsComplete, contentState, unavailableReason, canPreview
        case canPreviewBefore, canPreviewAfter, changeRange, metadata, canReference
    }

    var id: String { changeId ?? entryId ?? relativePath }
    var isDirectory: Bool { kind == "directory" }
    var isOrdinary: Bool { kind == "file" || isDirectory }
}
nonisolated struct WorkspaceFileHunk: Decodable, Identifiable, Hashable, Sendable {
    let hunkId: String
    var oldStart: Int?
    var oldCount: Int?
    var newStart: Int?
    var newCount: Int?
    var continued: Bool?
    var lineOffset: Int?
    let lines: [WorkspaceFileLine]
    var id: String { hunkId }
}
nonisolated struct WorkspaceFileLine: Decodable, Identifiable, Hashable, Sendable {
    var lineId: String?
    var hunkId: String?
    var position: Int?
    let kind: String
    var oldLineNumber: Int?
    var newLineNumber: Int?
    let text: String
    var truncated: Bool?
    var id: String { lineId ?? "\(hunkId ?? ""):\(position ?? oldLineNumber ?? newLineNumber ?? 0):\(kind)" }
}

nonisolated struct WorkspaceFilesMetadata: Decodable, Hashable, Sendable {
    let sizeBytes: Int?
    let modifiedAt: String?
}
nonisolated struct WorkspacePreviewLine: Decodable, Hashable, Sendable {
    let lineNumber: Int
    let text: String
    let truncated: Bool
}

nonisolated struct WorkspaceFilesScope: Equatable, Sendable {
    let id: String
    let rootEntryId: String
    let mode: WorkspaceFilesScopeMode
    let rootDisplayName: String
    let contextVersion: String
    let gitAvailable: Bool
    var gitUnavailableReason: String? = nil
}

nonisolated struct WorkspaceFilesFailure: Error, Equatable, Sendable {
    let code: String
    let message: String
    var displayMessage: String { code == "cursor_expired" ? "分页已过期，请重新打开" : message }
    static let unavailable = Self(code: "unsupported_version", message: "请更新电脑端与服务端后重试。")
    static let offline = Self(code: "desktop_offline", message: "电脑离线，请连接后重试。")
    static let cancelled = Self(code: "cancelled", message: "读取已取消。")
    static let invalid = Self(code: "invalid_result", message: "电脑返回的文件数据无效，请刷新。")
}

nonisolated struct WorkspaceFilesWelcome: Decodable {
    struct Capabilities: Decodable { let workspaceFilesVersion: Int? }
    let mobileCapabilities: Capabilities?
}
