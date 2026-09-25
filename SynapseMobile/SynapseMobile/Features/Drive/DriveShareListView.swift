import SwiftUI
import UIKit

/// 分享管理行副标题那几段（Spec §4.7 那张表里分享那一行）。
///
/// 纯函数：这一段是用户分辨两条分享的**全部**依据 —— 同一份文件可能有一条「仅阅读」和一条
/// 「有密码」，行上的名字是一样的。算错了不会崩，只会让人点开错的链接，所以它钉在
/// `DriveListTests`。不读 `UserDefaults`。
enum DriveShareRow {
    /// 「仅阅读 · 永久有效 · 有密码 · 来源已删除」。
    ///
    /// 访问权限与有效期永远在（服务端必给，缺了就按最保守的那一档说）；「有密码」与
    /// 「来源已删除」是有才说 —— 没有的东西不该占一段。「来源已删除」必须说：链接打开是
    /// 空的，而这一行是用户点开它之前唯一能看到的东西。
    static func subtitle(for share: DriveShareListItem) -> String {
        var parts = [
            DriveText.shareModeLabel(share.accessMode),
            // 有效期那一段与分享结果页逐字相同（`DriveShareSummary.expiry`）：同一件事
            // 在两处不该有两种说法。
            DriveShareSummary.expiry(share.expiresAt),
        ]
        if share.passwordEnabled { parts.append("有密码") }
        if share.sourceDeleted { parts.append("来源已删除") }
        return parts.joined(separator: " · ")
    }
}

/// 分享管理（Spec §3 的「工具栏菜单 → 分享管理」）：现在有哪些链接在外面。
///
/// **进屏必须自己拉一次** `shares`。那是 `DriveStore.shares` 唯一该被加载的地方：本机那份
/// 列表同时喂着两条路 —— `DriveSharePlan` 的复用快路（已有那条没被改过时连请求都不发）
/// 与 `DriveItemInfoView` 的「这一项有分享」那一行。不拉它，这两条在用户第一次进这一屏
/// 之前都不可达。
///
/// 服务端只给**还活着的**那些（`enabled: true` 且没过期），所以每一行都还能点开、都能拷。
///
/// 调用方把它**推入**一个已有的 `NavigationStack`（工具栏「···」菜单里那一项）：本视图不带
/// 自己的 `NavigationStack`。
struct DriveShareListView: View {
    /// 窗口有多宽（由调用方从**窗口那一层**传下来，不是这里自己读的）。
    ///
    /// 只用来判这一条列表要不要挂下拉刷新，理由见 `refreshableIfCompact`：列里读到的
    /// `horizontalSizeClass` 是列自己的，读它会判错。
    let isCompact: Bool

    @Environment(SynapseAppModel.self) private var model
    /// 点开的那一行。
    @State private var openShare: DriveShareListItem?

    var body: some View {
        List {
            if let error = model.drive.sharesErrorMessage {
                // 与回收站那一屏同一条：失败说成一行，不叠空态，重试就是下拉
                // （紧凑宽度下；宽窗下这条下拉刷新不挂，见 `refreshableIfCompact`，那时离开这一屏
                // 再进来的 `.task` 就是重试）。
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }
            Section {
                ForEach(model.drive.shares) { share in
                    row(share)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.drive.shares.isEmpty {
                if model.drive.sharesLoading {
                    ProgressView()
                } else if model.drive.sharesErrorMessage == nil {
                    // 不放「长按文件可以创建分享链接」那类说明：这一页能不能建分享不取决于
                    // 在这儿说了什么，而空态只该说「这里现在没有东西」。
                    ContentUnavailableView("没有进行中的分享", systemImage: "link")
                }
            }
        }
        .navigationTitle("分享管理")
        .task {
            await model.driveLoadShares()
        }
        .refreshableIfCompact(isCompact) {
            await model.driveLoadShares()
        }
        // 结果页盖在这一屏上（`DriveItemInfoView` 对分享那一层是同一个做法）。
        //
        // **回来时重取一次**：`share()` 成功之后会就地删掉本机那一行
        // （`DriveStore.forgetShare(forItemId:)`），不重取的话那一行会从列表里消失，直到
        // 用户下次再进这一屏。停用分享那一趟 store 自己已经重取过，所以这里偶尔是白跑一次
        // —— 一次 GET 换「回来时列表一定是全的」，这个价换得起。
        .sheet(item: $openShare, onDismiss: { Task { await model.driveLoadShares() } }) { share in
            DriveShareDetailView(share: share)
        }
        .noticeOverlay(model)
    }

    /// 一行：链接符号 + 文件/文件夹名 + 「访问权限 · 有效期 · 有密码」。
    ///
    /// 右边那枚 chevron 是这一屏唯一的手势提示：点进去是那一条分享的结果页（拷贝链接 /
    /// 停止分享），不是这个列表里能做完的事。
    private func row(_ share: DriveShareListItem) -> some View {
        Button {
            openShare = share
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "link")
                    .foregroundStyle(Color(uiColor: .systemBlue))
                VStack(alignment: .leading, spacing: 3) {
                    Text(share.itemName)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(DriveShareRow.subtitle(for: share))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            // 整行都是点击目标，44pt 加在这一行上，不是按钮外面。
            .frame(minHeight: Metrics.minimumTapTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// 一条分享的结果页（Spec §4.5 的结果页，只是这一条已经存在）。
///
/// 两行链接各自可拷（密码开着时还多出带密码链接与密码本身），底下是「停止分享」。
/// 链接与密码**只**进剪贴板：不写日志、不进 `AppLog`。
private struct DriveShareDetailView: View {
    let share: DriveShareListItem

    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    /// 停止分享那一趟在飞。
    @State private var stopping = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(share.itemName)
                            .font(.headline)
                        // 与列表行同一句话（`DriveShareRow`）：用户在上一屏看的就是它。
                        Text(DriveShareRow.subtitle(for: share))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                } footer: {
                    // 来源删了就得在这一页说：这一页上那颗「拷贝链接」会把一条打开是空的
                    // 链接交到手上。
                    if share.sourceDeleted {
                        Text("来源已删除，链接打开是空的。")
                    }
                }
                Section {
                    linkRow("链接", share.url)
                    // 密码关着时这两行不说：没有的东西不该占一行（Spec §4.5 的结果页只在
                    // 密码开着时才给带密码链接与密码）。
                    if share.passwordEnabled {
                        linkRow("带密码链接", share.urlWithPassword)
                        if let password = share.password, !password.isEmpty {
                            linkRow("密码", password)
                        }
                    }
                }
                Section {
                    Button(role: .destructive) {
                        stop()
                    } label: {
                        HStack {
                            Spacer()
                            if stopping {
                                ProgressView()
                            } else {
                                Text("停止分享")
                            }
                            Spacer()
                        }
                        .frame(minHeight: Metrics.minimumTapTarget)
                        .contentShape(Rectangle())
                    }
                    .disabled(stopping)
                }
            }
            .navigationTitle("分享")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // 这一张自己会发提示（拷贝、失败），而提示条画在宿主屏幕上、在这一张之下 ——
        // 不在这里挂一份就永远看不见（`DriveShareSheet` 同一条）。
        .noticeOverlay(model)
    }

    /// 一行可拷的东西：名字 + 值 + 一颗「拷贝」。
    ///
    /// 值用 `textSelection` 而不是只靠拷贝键：用户想拷一半（比如只拷路径里的一段）时也拿得到。
    private func linkRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.footnote)
                    .textSelection(.enabled)
                    .lineLimit(3)
            }
            Spacer(minLength: 8)
            Button { copy(value) } label: {
                // 44pt 加在 label 上：加在按钮外面时按到边缘不算数（见
                // `DriveMoveTargetPicker.row` 那段）。
                Text("拷贝")
                    .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
            }
            .buttonStyle(.borderless)
        }
    }

    /// 拷一行里的东西。与 `DriveShareSheet` 里那颗同一条：嗡一声 + 一句提示，固定 id。
    private func copy(_ value: String) {
        UIPasteboard.general.string = value
        Haptics.success()
        model.notice("已复制", tone: .success, id: "drive.share.copied")
    }

    /// 停止分享：链接立刻失效，记录还在（`DriveStore.disableShare`）。
    ///
    /// 成了 store 自己会重取分享列表，这一张只管收起来；失败留在这一页，那一句原因由这一页
    /// 自己的提示条说。**不可撤销**（再分享出去的是另一条链接），所以给一声警告式反馈 ——
    /// 和回收站里那个移除同一类动作。
    private func stop() {
        guard !stopping else { return }
        stopping = true
        Task {
            let outcome = await model.driveDisableShare(share)
            stopping = false
            if let notice = outcome.noticeText("停止分享") {
                model.notice(notice, tone: .failure)
                return
            }
            Haptics.warning()
            dismiss()
        }
    }
}
