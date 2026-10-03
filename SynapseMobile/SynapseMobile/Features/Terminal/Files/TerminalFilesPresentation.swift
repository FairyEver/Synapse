import SwiftUI

/// Keeps the terminal's large modifier graph independent of the files feature.
struct TerminalFilesPresentation: ViewModifier {
    @Environment(SynapseAppModel.self) private var model
    @Binding var flow: WorkspaceFilesFlow?
    @Binding var draft: String
    let sessionId: String
    let onDismiss: () -> Void
    let onDraftChanged: (String) -> Void
    let onReference: (String, WorkspaceFilesFlow) async -> Bool

    func body(content: Content) -> some View {
        content
            // The Files sheet is modal. Keep its covered terminal controls out
            // of assistive navigation, and restore them when the sheet closes.
            .accessibilityHidden(flow != nil)
            .sheet(item: $flow, onDismiss: onDismiss) { current in
                WorkspaceFilesPanel(flow: current) { entryId in await onReference(entryId, current) }
            }
            .onChange(of: draft) { _, text in onDraftChanged(text) }
            .onChange(of: model.selectedDesktopClientInstanceId) { flow = nil }
            .onChange(of: model.connectivity) { flow?.checkConnectivity() }
            .onChange(of: model.terminalOpenability(sessionId)) { _, state in
                if state == .ended { flow = nil } else { flow?.checkConnectivity() }
            }
    }
}

struct TerminalGitFilesPresentation: ViewModifier {
    @Environment(SynapseAppModel.self) private var model
    @Binding var flow: TerminalGitFlow?
    let sessionId: String
    let onDismiss: () -> Void
    let onReview: (TerminalGitFlow) -> Void

    func body(content: Content) -> some View {
        content.sheet(item: $flow, onDismiss: onDismiss) { current in
            TerminalGitPanel(flow: current, onReviewChanges: { onReview(current) })
                .noticeOverlay(model, forSession: sessionId)
        }
    }
}
