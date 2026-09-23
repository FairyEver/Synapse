import Foundation

/// 哪些分组配了启动命令，以及是哪台电脑说的。
///
/// 三个值，与 `TerminalQuickPhrasesState` 同一套规则：
///
/// - 收到过，且里面提到这个分组 → 有命令：分组行上画箭头，点进去是命令列表；
/// - 收到过，但里面没有这个分组 → 没命令：点了直接建终端，与今天完全一样；
/// - 从没收到过（那台电脑太旧）→ 同上，没箭头、直接建终端。
///
/// 后两者在屏幕上是同一个样子，所以这里不必把它们分开 —— 但整份列表必须按电脑归档：
/// 手机会同时连着几台电脑，把另一台的分组当成这一台的，就会画出一个点开是空列表的箭头。
///
/// 与 `TerminalToolbarState` 一样是**单槽**：消息自带发送者，而问题永远是「我正在看的
/// 那台电脑」。
struct TerminalGroupCommandState: Equatable {
    private var entries: [MobileGroupCommandsEntry] = []
    private var ownerDesktopClientInstanceId: String?

    /// 谁发的就收谁的，而不是「不是当前这台就丢掉」：`sync` 只发给选中的那台电脑，所以
    /// 一条别的电脑的消息是迟到的旧答案，不是错误。留着它花一个槽，省一次往返。
    mutating func adopt(_ payload: MobileGroupCommandsPayload) {
        entries = payload.groups
        ownerDesktopClientInstanceId = payload.desktopClientInstanceId
    }

    /// 登出时清空：那是上一个账号的电脑上的东西。
    mutating func reset() {
        entries = []
        ownerDesktopClientInstanceId = nil
    }

    /// 这个分组有没有配命令，对正在看的那台电脑而言。
    func hasCommands(for groupId: String, onSelected desktopClientInstanceId: String?) -> Bool {
        !commands(for: groupId, onSelected: desktopClientInstanceId).isEmpty
    }

    /// 这个分组配的命令，按电脑上的顺序。
    func commands(for groupId: String, onSelected desktopClientInstanceId: String?) -> [MobileGroupCommand] {
        guard let desktopClientInstanceId,
              ownerDesktopClientInstanceId == desktopClientInstanceId
        else { return [] }
        return entries.first { $0.groupId == groupId }?.commands ?? []
    }
}
