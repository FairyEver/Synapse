import Testing
@testable import SynapseMobile

/// The list has to express which terminals share a tab, without inventing a layer
/// for terminals that do not. These pin down both halves of that.
struct SessionListBlocksTests {

    @Test func keepsEveryTerminalFlatWhenNoTabIsSplit() {
        let blocks = sessionListBlocks(
            sessions: [session("a"), session("b"), session("c")],
            workspaces: [],
        )

        #expect(blocks == [.session(id: "a"), .session(id: "b"), .session(id: "c")])
    }

    /// The split tab is drawn where its first pane already was, so turning a
    /// terminal into a split does not shuffle the rows around it.
    @Test func drawsASplitTabWholeAtItsFirstPane() {
        let blocks = sessionListBlocks(
            sessions: [session("a"), session("b"), session("c"), session("d")],
            workspaces: [workspace(id: "w1", title: "前端", sessionIds: ["b", "c"])],
        )

        #expect(blocks == [
            .session(id: "a"),
            .tab(id: "w1", title: "前端", sessionIds: ["b", "c"]),
            .session(id: "d"),
        ])
    }

    /// Pane order is the desktop's, not the order the sessions arrive in — the
    /// panes are laid out left to right on the desktop and should read that way.
    @Test func usesPaneOrderWithinATab() {
        let blocks = sessionListBlocks(
            sessions: [session("a"), session("b"), session("c")],
            workspaces: [workspace(id: "w1", title: "t", sessionIds: ["c", "a"])],
        )

        #expect(blocks == [
            .tab(id: "w1", title: "t", sessionIds: ["c", "a"]),
            .session(id: "b"),
        ])
    }

    @Test func keepsSeveralTabsApart() {
        let blocks = sessionListBlocks(
            sessions: [session("a"), session("b"), session("c"), session("d")],
            workspaces: [
                workspace(id: "w1", title: "一", sessionIds: ["a", "c"]),
                workspace(id: "w2", title: "二", sessionIds: ["b", "d"]),
            ],
        )

        #expect(blocks == [
            .tab(id: "w1", title: "一", sessionIds: ["a", "c"]),
            .tab(id: "w2", title: "二", sessionIds: ["b", "d"]),
        ])
    }

    /// A tab is only drawn from panes present in this snapshot. With none of them
    /// left there is nothing to open, so the tab itself is not drawn.
    @Test func dropsATabWhoseTerminalsAreGone() {
        let blocks = sessionListBlocks(
            sessions: [session("a")],
            workspaces: [workspace(id: "w1", title: "gone", sessionIds: ["x", "y"])],
        )

        #expect(blocks == [.session(id: "a")])
    }

    /// A pane that went away while its tab is still open leaves the tab drawn for
    /// the panes that remain.
    @Test func keepsATabForTheePanesThatRemain() {
        let blocks = sessionListBlocks(
            sessions: [session("a"), session("b")],
            workspaces: [workspace(id: "w1", title: "part", sessionIds: ["a", "gone", "b"])],
        )

        #expect(blocks == [.tab(id: "w1", title: "part", sessionIds: ["a", "b"])])
    }

    // MARK: - Fixtures

    private func session(_ id: String) -> MobileSummarySession {
        MobileSummarySession(
            id: id,
            groupId: "g1",
            title: id,
            status: "running",
            attention: MobileSummaryAttention(state: "not_waiting", kind: "unknown"),
            cwd: "/tmp",
            cols: 80,
            rows: 24,
            startedAt: "2026-01-01T00:00:00.000Z",
            lastLine: "",
            lastOutputSeq: 0,
        )
    }

    private func workspace(id: String, title: String, sessionIds: [String]) -> MobileSummaryWorkspace {
        MobileSummaryWorkspace(
            id: id,
            groupId: "g1",
            title: title,
            panes: sessionIds.map { MobileSummaryWorkspacePane(paneId: "pane-\($0)", sessionId: $0) },
        )
    }
}
