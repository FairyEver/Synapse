import Foundation

/// One entry of a group's list, in the order it should be drawn.
enum SessionListBlock: Identifiable, Equatable {
    /// A terminal that is a tab of its own.
    case session(id: String)
    /// A tab holding more than one terminal, drawn as one block.
    case tab(id: String, title: String, sessionIds: [String])

    var id: String {
        switch self {
        case .session(let id): return "session:\(id)"
        case .tab(let id, _, _): return "tab:\(id)"
        }
    }
}

/// Flattens a group's terminals into drawable blocks.
///
/// Walking `sessions` in order and emitting a tab whole at the position of its
/// first pane is what makes the common cases fall out for free rather than needing
/// branches of their own:
///
/// - A desktop that sends no `workspaces` — an older one, or one with no splits —
///   yields one plain entry per terminal: exactly the list this screen drew before
///   tabs existed.
/// - A tab with a single pane is never in `workspaces` (the producer keeps only
///   splits), so it stays a plain row and nothing is drawn for one child.
/// - Adding a split to a tab does not move the rows around it.
func sessionListBlocks(
    sessions: [MobileSummarySession],
    workspaces: [MobileSummaryWorkspace],
) -> [SessionListBlock] {
    let present = Set(sessions.map(\.id))
    var tabIdBySession: [String: String] = [:]
    var titleByTab: [String: String] = [:]
    var sessionIdsByTab: [String: [String]] = [:]

    for workspace in workspaces {
        // Drawn from the panes that are actually in this snapshot: a tab whose
        // terminals have all gone is skipped rather than drawn empty.
        let sessionIds = workspace.panes.map(\.sessionId).filter(present.contains)
        guard !sessionIds.isEmpty else { continue }
        titleByTab[workspace.id] = workspace.title
        sessionIdsByTab[workspace.id] = sessionIds
        for sessionId in sessionIds {
            tabIdBySession[sessionId] = workspace.id
        }
    }

    var blocks: [SessionListBlock] = []
    var emitted = Set<String>()
    for session in sessions {
        guard let tabId = tabIdBySession[session.id] else {
            blocks.append(.session(id: session.id))
            continue
        }
        guard !emitted.contains(tabId), let sessionIds = sessionIdsByTab[tabId] else { continue }
        emitted.insert(tabId)
        blocks.append(.tab(id: tabId, title: titleByTab[tabId] ?? "", sessionIds: sessionIds))
    }
    return blocks
}
