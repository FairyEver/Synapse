import Foundation

/// 锁定态那两次高度变化，该不该告诉电脑（设计文档 §4.9）。
///
/// 锁定让输入栏长高到三行，手机的可视行数随之变小。桌面看不到这条栏，报出去只会为
/// 一次语音输入白 resize 两次 —— 进锁定一次、出锁定一次。
///
/// 与系统键盘那条既有规则（`reportGridToDesktop` 里的 `inputFocused`）同一个道理，
/// 但多一层：键盘收起时会补报一次，因为键盘真的改变了可视区；锁定这两次变化从头到尾
/// 只发生在手机上，所以进出都不报。
///
/// 纯值：不认识视图，也不认识格子是怎么发出去的，所以「进锁定不报、退出锁定也不报、
/// 但转个方向照样报」能被单测逐条走完 —— 否则这一条只能靠人盯着电脑屏幕看。
struct VoiceGridHold: Equatable {
    /// 锁定期内一律不报。
    private var locked = false
    /// 进锁定前桌面手上拿着的那一格。退出锁定会重排回它，而重排回一个已知的值不该
    /// 算新闻。
    private var gridBeforeLock: DesktopGrid?

    /// 输入栏换成了录音会话栏。
    var isLocked: Bool { locked }

    /// 右滑锁定：录音继续，这一格换成录音会话栏。
    mutating func lock(holding grid: DesktopGrid) {
        locked = true
        gridBeforeLock = grid
    }

    /// 退出锁定。松手的「确定」、左端的「放弃」、以及录音中途失败都从这里走。
    mutating func unlock() {
        locked = false
    }

    /// 这一次量到的格子要不要发给电脑。
    ///
    /// 问过一次就把「已知的那一格」清掉：它只对退出锁定之后紧跟着的那一次重排有效，
    /// 留在身上会把之后一次真的变化也一起吞掉。
    mutating func shouldReport(_ grid: DesktopGrid) -> Bool {
        guard !locked else { return false }
        let known = gridBeforeLock
        gridBeforeLock = nil
        return grid != known
    }
}
