import SwiftUI
import UIKit

/// 回收站行副标题那两段（Spec §4.6）。
///
/// 纯函数：算错了不会崩，只会让人读错「这一项会回到哪去」—— 恢复之前用户唯一能看的东西，
/// 也正是「恢复到原路径」这条动作的依据。与 `DriveItemInfo` 同一套写法，不读 `UserDefaults`。
enum DriveTrashRow {
    /// 「原路径 · 移入时间」。
    ///
    /// 两段都可能缺：服务端的 `originalPath` 是可选的（条目没有 `restorePath` 时就没有这一段），
    /// 时间戳也可能不是本机认得的格式。缺哪一段就少哪一段，不留一个吊在末尾的「 · 」；
    /// 两段都没有时说「—」，与列表里其它读不出来的值同一种说法。
    static func subtitle(for entry: DriveTrashEntry) -> String {
        let path = entry.originalPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let date = DriveText.date(entry.trashedAt)
        let parts = [path, date].filter { !$0.isEmpty }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }
}

/// 回收站（Spec §4.6）：恢复回原路径，或者从回收站里移掉。
///
/// **顺序由服务端定**（`drive-lifecycle.service.ts` 的 `ORDER BY "trashedAt" DESC NULLS LAST`），
/// 本机不重排：两份排序迟早会漂开，而这一屏的条数与顺序都是它说了算。搜索也走服务端
/// （`?search=`）—— 本地筛只能筛到已经加载的这一页，而用户要搜的是整个回收站。
///
/// **只取首页。** `DriveStore.pageLimit` 是服务端的上限 100，超过 100 条时手机端只看得到
/// 前 100 条（桌面端可以看全）。本期的已知上限，不做「加载更多」。
///
/// 普通项与公开素材共用这一份列表，恢复走哪条接口由 `DriveStore.restoreTrashEntry` 自己分
/// （条目上的 `isPublicAsset`），这一屏不判。
///
/// 调用方把它**推入**一个已有的 `NavigationStack`（它是列表底部那两个「位置」入口之一，
/// 不是一张 sheet）：本视图不带自己的 `NavigationStack`。
struct DriveTrashView: View {
    @Environment(SynapseAppModel.self) private var model

    /// 搜索框里的原文。归一之后的词才是发给服务端的那个，它也是这一屏取数的 id —— 敲一个
    /// 尾随空格不该再发一次请求。
    @State private var searchText = ""
    /// 等二次确认的那一条。
    @State private var purgeTarget: DriveTrashEntry?
    /// 行上那两条动作在飞。一次只办一件：连按两下「恢复」会发两次恢复。
    @State private var busy = false

    var body: some View {
        List {
            if let error = model.drive.trashErrorMessage {
                // 失败说成一行，不叠一层空态：一边说读不出来、一边说「回收站是空的」是
                // 自相矛盾，而这时候唯一诚实的说法是这一句（`MeetingListView` 同一条）。
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }
            Section {
                ForEach(model.drive.trash) { entry in
                    row(entry)
                }
            }
        }
        .listStyle(.insetGrouped)
        // 状态画在列表**上面**而不是列表里的一行：`ContentUnavailableView` 要的是整块内容区，
        // 而留在 `List` 上也让空态与失败态下照旧能下拉刷新（那里就是「重试」）。
        .overlay {
            if model.drive.trash.isEmpty {
                if model.drive.trashLoading {
                    ProgressView()
                } else if model.drive.trashErrorMessage == nil {
                    emptyState
                }
            }
        }
        .navigationTitle("回收站")
        // `displayMode: .always`：这一屏是**推进来**的，而默认的 `.automatic` 在推进来的页上
        // 不给搜索框（`.searchable` 只长在导航栈的根上）。`TerminalGitBranchList` 踩过同一条。
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "搜索回收站"
        )
        // 取数挂在搜索词上：进屏拉一次，之后每换一个词再拉一次。别名是**归一之后**的词，
        // 所以只有真的换了词才重取；连着敲的几次由 store 自己按「这一份结果是不是这个词的」
        // 认领（`isCurrentTrash`），先回来的旧词结果落不了地。
        .task(id: DriveSearchTerm.normalized(searchText)) {
            // 停一下再发：`searchable` 的词是连着变的，每敲一个字发一次请求只换来一串
            // 会被下一个词作废的响应与一串 loading 翻转，而结果只对停下来之后的那个词有意义。
            // 250ms 是打字间隔的量级；这一觉被取消就说明词又变了（或者用户退出了这一屏），
            // 那一趟本来就不该发。
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await model.driveLoadTrash(search: searchText)
        }
        .refreshable {
            await model.driveLoadTrash(search: searchText)
        }
        .alert(
            "从回收站移除？",
            isPresented: Binding(
                get: { purgeTarget != nil },
                set: { presented in if !presented { purgeTarget = nil } }
            ),
            presenting: purgeTarget
        ) { entry in
            // 这一下不可撤销：移出回收站之后本机没有任何入口再把它找回来。
            Button("移除", role: .destructive) {
                Haptics.warning()
                Task { await purge(entry) }
            }
            Button("取消", role: .cancel) {}
        } message: { entry in
            Text("「\(entry.name)」将从回收站移除，之后无法恢复。")
        }
        // 恢复 / 移除失败的那一句要看得见。这一屏是被推进来的，提示条挂在宿主屏幕上 ——
        // 不在这里挂一份就永远看不见。
        .noticeOverlay(model)
    }

    // MARK: - 一行

    /// 一行：图标 + 名字 + 「原路径 · 移入时间」。
    ///
    /// 两个动作走**手势的那套语法**（Spec §5.1 是「左滑 = 删除、右滑 = 分享」：右滑露建设性
    /// 的那个、左滑露破坏性的那个），长按菜单里同样两条 —— 手势快，菜单全。
    private func row(_ entry: DriveTrashEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: entry.isFolder ? "folder.fill" : "doc.fill")
                .foregroundStyle(iconTint(entry))
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.name)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(DriveTrashRow.subtitle(for: entry))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(minHeight: Metrics.minimumTapTarget)
        .contentShape(Rectangle())
        .contextMenu { actions(entry) }
        // 建设性的那个在最前面：右滑露出「恢复」，与浏览列表「右滑分享」同一个方向感。
        .swipeActions(edge: .leading) {
            Button {
                Task { await restore(entry) }
            } label: {
                Label("恢复", systemImage: "arrow.uturn.backward")
            }
            .tint(Color(uiColor: .systemBlue))
            .disabled(busy)
        }
        // 左滑露出「从回收站移除」。这一颗要自己指定底色：左滑动作是全局 tint 唯一被当成
        // **填充**用的地方，而主题色是 `Color.primary`，深色外观下就是白色，于是白底白图标
        // （`MeetingListView` 那段注释里记着这一条）。
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                purgeTarget = entry
            } label: {
                Label("移除", systemImage: "trash")
            }
            .tint(Color(uiColor: .systemRed))
            .disabled(busy)
        }
    }

    /// 文件夹用系统蓝（与云盘列表一致）；文件按扩展名那一类取 `DriveText.kindColor`。
    private func iconTint(_ entry: DriveTrashEntry) -> Color {
        entry.isFolder
            ? Color(uiColor: .systemBlue)
            : DriveText.kindColor(DriveText.kind(of: entry.name))
    }

    /// 长按菜单里的两条。与手势里那两条逐个对应，不另立说法。
    @ViewBuilder
    private func actions(_ entry: DriveTrashEntry) -> some View {
        Button {
            Task { await restore(entry) }
        } label: {
            Label("恢复到原路径", systemImage: "arrow.uturn.backward")
        }
        .disabled(busy)

        Button(role: .destructive) {
            purgeTarget = entry
        } label: {
            Label("从回收站移除", systemImage: "trash")
        }
        .disabled(busy)
    }

    // MARK: - 空态

    /// 搜不到与「一条都没有」是两件事，说法也不一样：前者是换个词再试，后者是回收站里
    /// 现在没东西。搜索时说「回收站是空的」是假话 —— 用户自己刚把词敲进去。
    @ViewBuilder
    private var emptyState: some View {
        if DriveSearchTerm.normalized(searchText) == nil {
            ContentUnavailableView("回收站是空的", systemImage: "trash")
        } else {
            ContentUnavailableView("没有匹配的项目", systemImage: "magnifyingglass")
        }
    }

    // MARK: - 两件事

    /// 恢复。成了由 store 自己重取这一页（那一条要从列表里消失，而「还剩多少」是服务端
    /// 说了算的），所以成功那一趟一个字都不说 —— 列表已经变了，再报一句是重复状态。
    private func restore(_ entry: DriveTrashEntry) async {
        guard !busy else { return }
        busy = true
        let outcome = await model.driveRestoreTrashEntry(entry)
        busy = false
        if let notice = outcome.noticeText("恢复") {
            model.notice(notice, tone: .failure)
        }
    }

    /// 从回收站里移掉。同样由 store 重取这一页。
    private func purge(_ entry: DriveTrashEntry) async {
        guard !busy else { return }
        busy = true
        let outcome = await model.drivePurgeTrashEntry(entry)
        busy = false
        if let notice = outcome.noticeText("移除") {
            model.notice(notice, tone: .failure)
        }
    }
}
