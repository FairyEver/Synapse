import Foundation
import os
import WidgetKit

/// Copies the selected computer's display summary into the WidgetKit App Group.
/// A widget never connects to the relay or receives an authentication token.
@MainActor
final class TerminalWidgetPublisher {
    private var lastSnapshot: TerminalWidgetSnapshot?
    private var lastReloadAt = Date.distantPast
    private var pendingReload: Task<Void, Never>?

    func publish(_ snapshot: TerminalWidgetSnapshot?) {
        guard let snapshot else {
            clear()
            return
        }
        guard snapshot != lastSnapshot else { return }
        let previous = lastSnapshot
        do {
            try TerminalWidgetShared.save(snapshot)
        } catch {
            AppLog.widget.error("terminal widget snapshot write failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        lastSnapshot = snapshot

        let important = previous?.desktopId != snapshot.desktopId
            || previous?.isOnline != snapshot.isOnline
            || statusSignature(previous) != statusSignature(snapshot)
        if important || Date().timeIntervalSince(lastReloadAt) >= 60 {
            reload()
        } else if pendingReload == nil {
            let delay = max(1, 60 - Date().timeIntervalSince(lastReloadAt))
            pendingReload = Task { [weak self] in
                try? await Task.sleep(for: .seconds(delay))
                guard !Task.isCancelled else { return }
                self?.reload()
            }
        }
    }

    func clear() {
        let hadSnapshot = lastSnapshot != nil || TerminalWidgetShared.load() != nil
        pendingReload?.cancel()
        pendingReload = nil
        do {
            try TerminalWidgetShared.clear()
        } catch {
            AppLog.widget.error("terminal widget snapshot clear failed: \(error.localizedDescription, privacy: .public)")
        }
        lastSnapshot = nil
        if hadSnapshot { reload() }
    }

    private func reload() {
        pendingReload?.cancel()
        pendingReload = nil
        lastReloadAt = .now
        WidgetCenter.shared.reloadTimelines(ofKind: TerminalWidgetShared.widgetKind)
    }

    private func statusSignature(_ snapshot: TerminalWidgetSnapshot?) -> String {
        guard let snapshot else { return "" }
        return snapshot.sessions.map {
            "\($0.id)|\($0.status)|\($0.attentionState)|\($0.attentionKind)"
        }.joined(separator: ";")
    }
}
