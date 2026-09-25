import SwiftUI

/// 主页功能里的「剪贴板历史」。
///
/// 就是 `ClipboardList` 的一层壳。它自己不自带 `NavigationStack`，而这一页推在主页的栈里
/// —— 栈已经有了，所以 `title` 传 `nil`：清空按钮并进这一页的导航栏，不另画一条。
///
/// 它在「功能」里而不是在终端里，因为它不绑定任何一个终端会话：不选会话也能进，
/// 选了会话也不影响它。挪出来之后终端列表那一页只剩设备行加会话。
struct ClipboardHistoryView: View {
    @Environment(SynapseAppModel.self) private var model

    var body: some View {
        ClipboardList(
            entries: model.activeClipboardEntries,
            title: nil,
            desktopName: model.selectedDesktopClientInstanceId.map { model.desktopName($0) },
            onCopy: { model.copyClipboardEntry($0) },
            onClear: { model.clearClipboardHistory(for: model.selectedDesktopClientInstanceId) }
        )
        .navigationTitle("剪贴板历史")
        .noticeOverlay(model)
    }
}
