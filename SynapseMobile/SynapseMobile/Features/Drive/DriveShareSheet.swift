import SwiftUI
import UIKit

/// 分享结果页上那几行字（Spec §4.5）。
enum DriveShareSummary {
    /// 顶上那一句：这一趟拿到的是新链接，还是原来那条。
    ///
    /// 「沿用」说的是**没有新建一条分享**，不是「地址字符串没变」：服务端复用同一条时
    /// 裸地址本来就不会变，而带密码链接与密码都可能被重算（见 `DriveShareOutcome`）。
    /// 所以文案得说「用的是原来那条分享」，说「地址没变」就是在说一件用户没问的事。
    static func headline(_ outcome: DriveShareOutcome) -> String {
        switch outcome {
        case .created: return "链接已就绪"
        case .reused: return "沿用已有分享，链接未变"
        case .failed: return "分享失败"
        }
    }

    /// 「报告.pdf · 仅阅读 · 永久有效」。
    static func line(itemName: String, share: DriveShare) -> String {
        [itemName, DriveText.shareModeLabel(share.accessMode), expiry(share.expiresAt)]
            .joined(separator: " · ")
    }

    /// 有效期怎么读。服务端不给到期时刻就是永久。
    static func expiry(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "永久有效" }
        let date = DriveText.date(iso)
        // 时间戳读不出来时按永久说：说「有效期至」后面空着，用户不知道这是什么意思。
        return date.isEmpty ? "永久有效" : "有效期至 \(date)"
    }
}

/// 分享一项：没有分享时先填那张三段表单，有的话直接给结果页。
///
/// 表单与结果页是**同一张 sheet 的两步**，不是两张：`share()` 成功之后要么换一条链接、
/// 要么沿用原来那条，两种情况用户都还在「分享这一项」这件事上。
///
/// 表单只在真的没有分享时才出现，而且永远从 `DriveShareForm.defaults` 起步
/// —— `settings(changedFrom:)` 发的是**相对那份初始值动过**的字段，所以「已有那条」的
/// 设置不会被一份默认表单悄悄改掉：用户什么都没动时发出去的是空体，服务端拿它当
/// 「复用已有那条，别动它的设置」。用户要是改了密码开关，那正是他明说要改。
struct DriveShareSheet: View {
    /// 要分享的那一项。
    let item: DriveBrowserItem
    /// 这一项的分享动过了（这一趟真的发过请求，或者沿用了本机记着的那一条）。
    ///
    /// 浏览层行尾那枚 link 角标来自快照，只有重取才会更新（Spec §4.3），所以收下这个信号
    /// 的一方要重取一次当前层。收起时的那次刷新也可以由调用方的 `.sheet(onDismiss:)` 接：
    /// 两条路都不缺东西，而这一条更精确——只在真的动过分享时才发。
    let onShared: () -> Void

    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// 走到哪一步了。
    private enum Phase {
        /// 还在看这一项有没有现成的分享。
        case probing
        /// 要新建：那张三段表单。
        case form
        /// 结果页。
        case result(DriveShareOutcome)
    }

    @State private var phase: Phase = .probing
    /// 表单里那三项。与 `phase` 分开存：绑到枚举的关联值上要自己拼 `Binding`，而这几项
    /// 本来就是一份独立的状态。
    @State private var form = DriveShareForm.defaults
    @State private var submitting = false

    init(item: DriveBrowserItem, onShared: @escaping () -> Void = {}) {
        self.item = item
        self.onShared = onShared
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("分享")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await begin() }
        // 失败那一句要看得见：提示条画在宿主屏幕上、在这一张之下。
        .noticeOverlay(model)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        switch phase {
        case .probing:
            // 还在看有没有现成的分享，这一步没有能做的决定。
            ToolbarItem(placement: .cancellationAction) {
                Button("取消") { dismiss() }
            }
        case .form:
            ToolbarItem(placement: .cancellationAction) {
                Button("取消") { dismiss() }
                    .disabled(submitting)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("创建", action: submit)
                    .disabled(submitting)
            }
        case .result:
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .probing:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .form:
            formBody
        case .result(let outcome):
            resultBody(outcome)
        }
    }

    // MARK: - 表单

    private var formBody: some View {
        Form {
            Section {
                Picker("有效期", selection: $form.expiry) {
                    // 顺序就是 `allCases` 的顺序（Spec §4.5）。
                    ForEach(DriveExpiry.allCases, id: \.self) { expiry in
                        Text(DriveText.expiryLabel(expiry)).tag(expiry)
                    }
                }
                .pickerStyle(.menu)
            } header: {
                // 说清这是在给哪一项建分享：这一页上没有别处提到它。
                Text(item.name)
            }
            Section("访问权限") {
                Picker("访问权限", selection: $form.accessMode) {
                    // 只有两档。「指定邮箱可编辑」要一张邮箱名单，而本期的对话框族里
                    // 没有输入名单的地方——放一档进来点不动，不如先不放。
                    Text(DriveText.shareModeLabel(.linkRead)).tag(DriveAccessMode.linkRead)
                    Text(DriveText.shareModeLabel(.linkEdit)).tag(DriveAccessMode.linkEdit)
                }
                .pickerStyle(.segmented)
                // 不隐藏标签，分段控件就得跟「访问权限」四个字挤一行，两段都只剩半个字。
                .labelsHidden()
            }
            Section {
                Toggle("密码保护", isOn: $form.passwordEnabled)
                    .tint(Theme.switchOn)
            }
        }
        .disabled(submitting)
    }

    // MARK: - 结果

    private func resultBody(_ outcome: DriveShareOutcome) -> some View {
        List {
            if let share = outcome.share {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(DriveShareSummary.headline(outcome))
                            .font(.headline)
                        Text(DriveShareSummary.line(itemName: item.name, share: share))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }
                Section {
                    linkRow("链接", share.url)
                    // 密码关着时这两行不说：没有的东西不该占一行（Spec §4.5 的结果页
                    // 只在密码开着时才给带密码链接与密码）。
                    if share.passwordEnabled {
                        linkRow("带密码链接", share.urlWithPassword)
                        if let password = share.password, !password.isEmpty {
                            linkRow("密码", password)
                        }
                    }
                }
            }
        }
    }

    /// 一行可拷的东西：名字 + 值 + 一颗「拷贝」。
    ///
    /// 值用 `textSelection` 而不是只靠拷贝键：用户想拷一半（比如只拷路径里的一段）时
    /// 也拿得到。
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
                // `DrivePreviewPane.tappableLabel` 那段）。
                Text("拷贝")
                    .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
            }
            .buttonStyle(.borderless)
        }
    }

    /// 拷贝一行里的东西。
    ///
    /// 链接与密码**只**进剪贴板：不写日志、不进 `AppLog`，它们离开这一屏就是这一页唯一的
    /// 结果，所以给一声嗡 + 一句提示（本仓其它几处拷贝都是这么做的）。
    private func copy(_ value: String) {
        UIPasteboard.general.string = value
        Haptics.success()
        // 一个固定的 id：连着拷两行时重启这一句，而不是排两句一模一样的「已复制」。
        model.notice("已复制", tone: .success, id: "drive.share.copied")
    }

    // MARK: - 走哪一步

    /// 这一张打开时该显示哪一步。
    private func begin() async {
        // 本机已经知道这一项有分享：不发请求，直接把那条链接摆出来（`DriveSharePlan` 的
        // 复用快路也是这么判的）。
        if let known = model.drive.existingShare(forItemId: item.id) {
            phase = .result(.reused(known))
            return
        }
        // 不知道就先拉一次分享列表。拉到了能省掉一次请求（复用快路），也能直接把结果页
        // 摆出来；拉不到（网络断了、这一条在列表的下一页之外）不影响下面几条判据。
        await model.driveLoadShares()
        if let known = model.drive.existingShare(forItemId: item.id) {
            phase = .result(.reused(known))
            return
        }
        // 浏览行上那枚角标说这一项有分享，而本机手里没有它：用户要的是那一条链接，
        // 不是再建一条 —— 空体的一次请求正是服务端的「复用已有那条，别动它的设置」，
        // 于是这一趟不会建出第二个分享，回来的编号也与原来那条相同（Spec §4.5）。
        if DriveShareLink.shareId(inBrowserPath: item.shareUrl) != nil {
            await create(settings: APIClient.DriveShareSettings())
            return
        }
        phase = .form
    }

    private func submit() {
        guard !submitting else { return }
        Task { await create(settings: form.settings(changedFrom: .defaults)) }
    }

    /// 请求一次分享。
    ///
    /// 请求在这一张还开着的时候发（按钮那条，`submitting` 锁住表单），落地了才走下一步：
    /// 失败时留在表单上，用户刚选的那几项还在，改一下就能重来（多数失败只是网络抖了一下）。
    private func create(settings: APIClient.DriveShareSettings) async {
        submitting = true
        let outcome = await model.driveShare(item: item, settings: settings)
        submitting = false
        switch outcome {
        case .failed(let reason):
            model.notice(reason, tone: .failure)
            if case .form = phase { return }
            phase = .form
        case .created, .reused:
            phase = .result(outcome)
            onShared()
        }
    }
}
