import Foundation

/// 一次终端操作属于发起时的账号与电脑；切走再切回来也不是同一次观看。
struct TerminalActionContext: Equatable {
    let desktopId: String
    let accountGeneration: Int
    let viewingGeneration: Int

    @MainActor
    func remainsCurrent(
        while waiting: () async -> Void,
        current: () -> TerminalActionContext?
    ) async -> Bool {
        guard current() == self, !Task.isCancelled else { return false }
        await waiting()
        return current() == self && !Task.isCancelled
    }
}
