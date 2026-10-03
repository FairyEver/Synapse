import Foundation

struct WorkspaceFilesOwner: Equatable, Sendable {
    let accountGeneration: Int
    let connectionGeneration: Int
    let desktopId: String
    let mobileId: String
    let sessionId: String

    func sameTarget(as other: Self) -> Bool {
        accountGeneration == other.accountGeneration && desktopId == other.desktopId
            && mobileId == other.mobileId && sessionId == other.sessionId
    }
}

enum WorkspaceFilesCapabilities {
    static func supportsFiles(relayVersion: Int?, desktopVersion: Int?) -> Bool {
        relayVersion == 1 && desktopVersion == 1
    }
}

enum WorkspaceFilesFallbackPolicy {
    static func allowsFallback(owner: WorkspaceFilesOwner, current: WorkspaceFilesOwner?,
                               available: Bool, remainingSeconds: TimeInterval) -> Bool {
        available && current == owner && remainingSeconds > 0 && remainingSeconds <= 15
    }
}

extension MobileIntentResultPayload {
    func matchesWorkspaceOwner(_ owner: WorkspaceFilesOwner, current: WorkspaceFilesOwner?) -> Bool {
        desktopClientInstanceId == owner.desktopId && mobileClientInstanceId == owner.mobileId && current == owner
    }
}

/// The feature sees a narrow transport; the application's existing intent funnel
/// remains the sole network writer. Tests replace this boundary, not the UI.
@MainActor
struct WorkspaceFilesClient {
    var owner: () -> WorkspaceFilesOwner?
    var availability: () -> WorkspaceFilesFailure?
    var send: (MobileIntentRequest, WorkspaceFilesOwner) async throws -> WorkspaceFilesResult
}

extension WorkspaceFilesResult {
    func validated(for request: MobileIntentRequest) throws -> WorkspaceFilesResult {
        guard filesVersion == 1, operation == request.operation, sessionId == request.sessionId,
              WorkspaceFilesWireValidation.timestamp(readAt),
              request.scopeId == nil || operation == .cancel || scopeId == request.scopeId,
              request.expectedContextVersion == nil || operation == .refresh || contextVersion == request.expectedContextVersion else {
            throw WorkspaceFilesFailure.invalid
        }
        if operation == .open || operation == .refresh {
            guard data.scopeId == scopeId, data.contextVersion == contextVersion,
                  data.scopeId?.isEmpty == false, data.contextVersion?.isEmpty == false,
                  data.rootEntryId?.isEmpty == false, data.rootDisplayName?.isEmpty == false,
                  data.scopeMode != nil, data.gitAvailable != nil,
                  operation != .open || data.scopeMode == request.scopeMode,
                  WorkspaceFilesWireValidation.timestamp(data.expiresAt),
                  WorkspaceFilesWireValidation.identifier(data.scopeId),
                  WorkspaceFilesWireValidation.identifier(data.contextVersion),
                  WorkspaceFilesWireValidation.identifier(data.rootEntryId),
                  (data.gitAvailable == false || data.gitUnavailableReason == nil),
                  data.gitUnavailableReason == nil || ["not_git_repository", "git_unavailable", "external_filter_required", "permission_denied", "unsafe_path", "limit_exceeded"].contains(data.gitUnavailableReason!) else { throw WorkspaceFilesFailure.invalid }
        } else if operation != .cancel && operation != .close {
            guard scopeId?.isEmpty == false, contextVersion?.isEmpty == false else { throw WorkspaceFilesFailure.invalid }
        }
        if [.directory, .search, .changes, .diff, .preview].contains(operation) {
            guard let index = data.pageIndex, index >= 0, index <= 100_000,
                  ["complete", "partial", "truncated"].contains(data.completion ?? ""),
                  (data.completion == "partial") == (data.nextCursor != nil),
                  (data.entries?.count ?? 0) <= 100,
                  data.nextCursor == nil || (data.nextCursor!.count <= 256 && !data.nextCursor!.isEmpty),
                  data.completion != "truncated" || data.truncatedReason?.isEmpty == false else {
                throw WorkspaceFilesFailure.invalid
            }
        }
        switch operation {
        case .directory:
            guard data.directoryVersion != nil, data.entries != nil, data.collectionComplete != nil else { throw WorkspaceFilesFailure.invalid }
        case .search:
            guard data.searchVersion != nil, data.entries != nil, data.scanComplete != nil, data.collectionComplete != nil,
                  let count = data.scannedEntries, (0...100_000).contains(count) else { throw WorkspaceFilesFailure.invalid }
        case .changes:
            guard data.changeSetVersion != nil, data.ranges != nil, data.entries != nil,
                  data.changeRange == request.changeRange, data.collectionComplete != nil, data.statsComplete != nil,
                  WorkspaceFilesWireValidation.statistics(data.ranges?.unstaged),
                  WorkspaceFilesWireValidation.statistics(data.ranges?.staged) else { throw WorkspaceFilesFailure.invalid }
        case .diff:
            guard data.contentVersion != nil, data.changeId == request.changeId, data.hunks != nil,
                  data.contentComplete != nil, WorkspaceFilesWireValidation.state(data.contentState), data.statsComplete != nil else { throw WorkspaceFilesFailure.invalid }
        case .preview:
            guard data.contentVersion != nil, data.lines != nil, WorkspaceFilesWireValidation.state(data.contentState),
                  ["text", "markdown"].contains(data.format ?? ""),
                  data.name?.isEmpty == false, WorkspaceFilesWireValidation.path(data.relativePath),
                  WorkspaceFilesWireValidation.metadata(data.metadata),
                  data.contentComplete != nil, data.source == request.target?.source,
                  data.side == request.target?.side else { throw WorkspaceFilesFailure.invalid }
        case .reference:
            guard let text = data.referenceText, !text.isEmpty, text.utf8.count <= 8192,
                  data.contextVersion == contextVersion else { throw WorkspaceFilesFailure.invalid }
        case .cancel:
            guard ["cancelled", "alreadyCompleted", "notFound"].contains(data.status ?? "") else { throw WorkspaceFilesFailure.invalid }
        case .close:
            guard ["closed", "alreadyClosed"].contains(data.status ?? ""), (data.pendingCancellationCount ?? -1) >= 0 else { throw WorkspaceFilesFailure.invalid }
        case .open, .refresh: break
        }
        for entry in data.entries ?? [] {
            guard WorkspaceFilesWireValidation.identifier(entry.id), WorkspaceFilesWireValidation.path(entry.relativePath) else { throw WorkspaceFilesFailure.invalid }
            if operation == .changes {
                guard WorkspaceFilesWireValidation.identifier(entry.changeId), entry.changeRange == request.changeRange,
                      ["modified", "added", "deleted", "renamed", "untracked", "conflict", "type_changed", "gitlink"].contains(entry.status ?? ""),
                      entry.statsComplete != nil, WorkspaceFilesWireValidation.state(entry.contentState),
                      entry.canPreviewBefore != nil, entry.canPreviewAfter != nil,
                      WorkspaceFilesWireValidation.count(entry.additions), WorkspaceFilesWireValidation.count(entry.deletions),
                      entry.oldRelativePath == nil || WorkspaceFilesWireValidation.path(entry.oldRelativePath) else { throw WorkspaceFilesFailure.invalid }
            } else {
                guard WorkspaceFilesWireValidation.identifier(entry.entryId), entry.displayName?.isEmpty == false,
                      ["file", "directory", "symlink", "special"].contains(entry.kind ?? ""),
                      WorkspaceFilesWireValidation.metadata(entry.metadata), entry.canPreview != nil, entry.canReference != nil,
                      entry.unavailableReason == nil || WorkspaceFilesWireValidation.state(entry.unavailableReason) else { throw WorkspaceFilesFailure.invalid }
            }
            if entry.kind == "symlink" || entry.kind == "special" {
                guard entry.canPreview == false, entry.canReference == false else { throw WorkspaceFilesFailure.invalid }
            }
        }
        for hunk in data.hunks ?? [] {
            guard hunk.lines.count <= 8192, WorkspaceFilesWireValidation.identifier(hunk.hunkId),
                  [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount, hunk.lineOffset].allSatisfy({ ($0 ?? -1) >= 0 }), hunk.continued != nil else { throw WorkspaceFilesFailure.invalid }
            for line in hunk.lines {
                guard ["context", "addition", "deletion", "meta"].contains(line.kind), line.text.utf8.count <= 8192, line.truncated != nil,
                      WorkspaceFilesWireValidation.count(line.oldLineNumber), WorkspaceFilesWireValidation.count(line.newLineNumber) else { throw WorkspaceFilesFailure.invalid }
            }
        }
        guard (data.lines?.count ?? 0) <= 8192,
              (data.lines ?? []).allSatisfy({ $0.lineNumber >= 0 && $0.text.utf8.count <= 8192 }) else { throw WorkspaceFilesFailure.invalid }
        return self
    }
}

private enum WorkspaceFilesWireValidation {
    static func identifier(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.count <= 120
    }
    static func path(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.isEmpty && value.utf8.count <= 4096 && !value.contains("\0")
            && !value.hasPrefix("/") && !value.split(separator: "/").contains("..")
    }
    static func timestamp(_ value: String?) -> Bool {
        guard let value, value.count <= 48, value.range(of: #"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$"#, options: .regularExpression) != nil else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = value.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter.date(from: value) != nil
    }
    static func state(_ value: String?) -> Bool {
        ["available", "binary", "unsupported_encoding", "external_filter_required", "unsupported_platform", "absent", "gitlink", "conflict", "type_change", "limit_exceeded", "special_file"].contains(value ?? "")
    }
    static func count(_ value: Int?) -> Bool { value == nil || value! >= 0 }
    static func metadata(_ value: WorkspaceFilesMetadata?) -> Bool {
        guard let value else { return false }
        return count(value.sizeBytes) && (value.modifiedAt == nil || timestamp(value.modifiedAt))
    }
    static func statistics(_ value: WorkspaceFilesSummary?) -> Bool {
        guard let value, let complete = value.collectionComplete, let computed = value.statsComplete else { return false }
        return count(value.fileCount) && count(value.additions) && count(value.deletions)
            && (complete || value.fileCount == nil) && (computed || (value.additions == nil && value.deletions == nil))
    }
}
