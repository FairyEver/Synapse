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

/// 这一项那一条分享现在是什么状况：读出来了 / 现在没有 / 没读到。
///
/// `missing` 与 `failed` 分开是这一层最要紧的一条：**这两条下面接的动作正好相反**。「没有」
/// 要摆出表单让用户建一条；「没读到」要停在那儿，什么都不建。把读不动当成没有，一次网络抖动
/// 就会变成一条用户没要的分享——而分享是拿着链接谁都能开的。
enum DriveShareLookup: Equatable {
    case found(DriveShare)
    /// 服务端说没有能用的那一条（404）：停用过的、过期过的都算（`drive.service.ts` 的
    /// `getShare` 只给 `enabled` 且没过期的）。
    case missing
    /// 没读到。`reason` 是给用户看的一句话。
    case failed(reason: String)

    /// 一次读为什么没成。
    static func of(_ error: Error) -> DriveShareLookup {
        if let apiError = error as? APIError, apiError.status == 404 { return .missing }
        return .failed(reason: DriveText.errorMessage(error))
    }
}

/// 「指定邮箱可编辑」那一档的名单：用户敲的那段文本 → 一份能发出去的邮箱数组。
///
/// 切分必须在本机做完。服务端只逐条 `trim().toLowerCase()` 再按
/// `^[^\s@]+@[^\s@]+\.[^\s@]+$` 验，**不切分**（`drive-share-access.ts`），分隔符留在里面时
/// 会有两种坏结果，而且都不报错：
/// - 两个地址被一个空格挤成一段（`a@x.com b@x.com`）——第二个 `@` 让整段过不了正则，请求
///   400，用户看到的是「可编辑用户邮箱无效。」，可他填的两个邮箱都是对的；
/// - 分隔符跟在末尾（`a@x.com,`）——`com,` 仍然满足 `[^\s@]+`，**验得过**：存下来的是一条谁
///   也对不上的地址，分享建成了、档位写着「指定邮箱可编辑」、没有人能编辑，而且没有任何
///   错误。全角逗号与顿号都能凑出这一种（它们既不是 `\s` 也不是 `@`）；全角空格与换行属于
///   `\s`，凑出的是上一种。
///
/// 所以分隔符要覆盖用户在中文输入法下真会敲的那几个，而不是只有半角逗号。
enum DriveShareEditors {
    /// 切分用的那些字符。
    ///
    /// `.whitespacesAndNewlines` 里已经有全角空格（U+3000 属于 `Zs`）与各种换行，不必单列；
    /// 剩下三个是中文输入法下当分隔符用的标点。
    private static let separators = CharacterSet(charactersIn: ",，、")
        .union(.whitespacesAndNewlines)

    /// 与 `normalizeDriveShareEditorEmail` 同一条正则，逐字照搬。
    private static let emailPattern = #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#

    /// 用户敲的这段文本现在是什么状态。
    enum Outcome: Equatable {
        /// 一个地址都没有。
        case empty
        /// 第一处不对的那一段（原样，好让用户在输入框里认出它）。
        case invalid(token: String)
        /// 可以发出去的名单：按用户写的顺序，小写、去过重。
        case ready([String])
    }

    /// 切成候选地址：只去掉空段，不判对错。
    static func tokens(_ text: String) -> [String] {
        text.components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func parse(_ text: String) -> Outcome {
        let candidates = tokens(text)
        guard !candidates.isEmpty else { return .empty }
        var seen = Set<String>()
        var emails: [String] = []
        for candidate in candidates {
            let email = candidate.lowercased()
            guard isValid(email) else { return .invalid(token: candidate) }
            // 去重按小写之后的形态：`A@x.com` 与 `a@x.com` 是同一个人，发两条过去服务端也会
            // 收成一条（它就是按小写去重的）。
            if seen.insert(email).inserted { emails.append(email) }
        }
        return .ready(emails)
    }

    /// 与 `normalizeDriveShareEditorEmail` 同一套判据：非空、不超过 320、形如邮箱。
    ///
    /// 长度按 UTF-16 数，不是按 `count`：服务端数的是 JS 的 `.length`，同一条地址在两边不该
    /// 一边收一边拒。
    static func isValid(_ email: String) -> Bool {
        guard !email.isEmpty, email.utf16.count <= 320 else { return false }
        return email.range(of: emailPattern, options: .regularExpression) != nil
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
        /// 要新建：那张表单。
        case form
        /// 结果页。
        case result(DriveShareOutcome)
        /// 有没有分享没读出来（`DriveShareLookup.failed`）。这一步**只**能重试或退出：
        /// 不知道有没有，就不能摆表单——那一页上的「创建」是会把分享建出来的。
        case probeFailed(String)
    }

    @State private var phase: Phase = .probing
    /// 表单里那几项。与 `phase` 分开存：绑到枚举的关联值上要自己拼 `Binding`，而这几项
    /// 本来就是一份独立的状态。
    @State private var form = DriveShareForm.defaults
    /// 邮箱那一栏的原文。
    ///
    /// 它是输入框里的东西，不是请求里的东西：`DriveShareForm` 装的是可以发出去的
    /// `[String]`，中间那一步切分/校验由 `DriveShareEditors` 现算（`requestSettings`），所以
    /// 不进那边那份共享状态。
    @State private var editorText = ""
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
        case .probeFailed:
            // 重试在正文里，那里有一句话要说；这里只留出口。
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
                    // 名单不对时连请求都不发：服务端那句「可编辑用户邮箱无效。」不会说是哪一段
                    // 不对，而这里是能说出那一段的地方（见 `editorsMessage`）。
                    .disabled(submitting || !canSubmit)
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
        case .probeFailed(let reason):
            probeFailedBody(reason)
        }
    }

    /// 没读出来那一页。
    ///
    /// 这一页上不给「创建」：这一项到底有没有分享还不知道，建出去的可能正是用户不想要的那
    /// 一条新链接。给一条重试的路（多半只是网络抖了一下），以及退出去。形状与别的失败页
    /// （`DriveMoveTargetPicker`）一致。
    private func probeFailedBody(_ reason: String) -> some View {
        ContentUnavailableView {
            Label(reason, systemImage: "exclamationmark.triangle")
        } actions: {
            Button {
                phase = .probing
                Task { await begin() }
            } label: {
                Text("重试").frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
            }
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
            Section {
                Picker("访问权限", selection: $form.accessMode) {
                    // 三档，顺序就是 Spec §4.5 里的顺序。这里用 `.menu` 而不是分段控件：
                    // 「指定邮箱可编辑」有七个字，三段挤一行会全部截断（有效期那一栏同理）。
                    Text(DriveText.shareModeLabel(.linkRead)).tag(DriveAccessMode.linkRead)
                    Text(DriveText.shareModeLabel(.linkEdit)).tag(DriveAccessMode.linkEdit)
                    Text(DriveText.shareModeLabel(.specifiedUsersEdit))
                        .tag(DriveAccessMode.specifiedUsersEdit)
                }
                .pickerStyle(.menu)
                // 名单只有这一档要有，这一栏也只在选中它时出现。
                if form.accessMode == .specifiedUsersEdit {
                    TextField("邮箱，用逗号或换行分隔", text: $editorText, axis: .vertical)
                        .lineLimit(2...5)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                        .frame(minHeight: Metrics.minimumTapTarget)
                        .accessibilityIdentifier("drive-share-editors-field")
                }
            } header: {
                Text("访问权限")
            } footer: {
                // 名单不对时的那一句，只在这儿说：这一页上只有这里知道是哪一段不对。
                if let message = editorsMessage {
                    Text(message)
                }
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

    // MARK: - 表单的判据

    /// 名单现在能不能用。
    private var parsedEditors: [String]? {
        if case .ready(let emails) = DriveShareEditors.parse(editorText) { return emails }
        return nil
    }

    /// 「创建」能不能按。只有「指定邮箱可编辑」这一档会挡住它：那一档要一份非空、每条都像
    /// 邮箱的名单（服务端会拒空名单），而这里能比服务端早一步说清是哪一段不对。
    private var canSubmit: Bool {
        form.accessMode != .specifiedUsersEdit || parsedEditors != nil
    }

    /// 名单不对时的那一句。对了就不说。
    private var editorsMessage: String? {
        switch DriveShareEditors.parse(editorText) {
        case .ready: return nil
        case .empty: return "请至少填一个邮箱。"
        case .invalid(let token): return "「\(token)」不是邮箱地址。"
        }
    }

    /// 这一趟要发出去的设置。
    ///
    /// 先把输入框里那段切出来再问 `settings(changedFrom:)`：那边判的是「相对默认值动过没有」，
    /// 而这一档的名单正是用户刚敲进去的东西。
    private var requestSettings: APIClient.DriveShareSettings {
        var snapshot = form
        if form.accessMode == .specifiedUsersEdit { snapshot.editorEmails = parsedEditors ?? [] }
        return snapshot.settings(changedFrom: .defaults)
    }

    // MARK: - 走哪一步

    /// 这一张打开时该显示哪一步。
    ///
    /// 三条判据，逐条都只读不写：本机记着的那条（不发请求）→ 浏览行角标里那个 `shareId` 拿
    /// 去服务端读一次 → 都没有就摆表单。**没有一步靠「发一次请求试试」**：分享的建立只能由
    /// 用户在表单上按下「创建」那一刻发生。
    private func begin() async {
        // 本机已经知道这一项有分享：不发请求，直接把那条链接摆出来（`DriveSharePlan` 的
        // 复用快路也是这么判的）。
        if let known = model.drive.existingShare(forItemId: item.id) {
            phase = .result(.reused(known))
            return
        }
        // 浏览行上那枚角标说这一项有分享，而本机手里没有这条链接。用户要的是**那一条**，
        // 所以去读它，而不是建一条新的。
        //
        // 这里是读，不是那趟空体 POST：空体在服务端是「没给设置」，没有活跃分享时它会
        // **建**一条（服务端默认：仅阅读 + 永久 + 无密码），停用过的会另建一条、过期过的会
        // 被悄悄续成默认有效期（`drive.service.ts` 的 `reusedExisting`）。角标是快照里的事，
        // 停用或过期都还在，所以「角标说有一条」与「现在真有一条」是两件事——这一条路由正
        // 好只给还活着的那条，404 就是「现在没有」。
        guard let shareId = DriveShareLink.shareId(inBrowserPath: item.shareUrl) else {
            // 角标也没有：这一项没有分享，直接摆表单（这一趟不做任何请求）。
            phase = .form
            return
        }
        switch await model.driveShareRecord(id: shareId) {
        case .found(let share):
            // 本机不知道、服务端有一条：这就是「沿用已有那条」，不必新建。
            phase = .result(.reused(share))
        case .missing:
            phase = .form
        case .failed(let reason):
            phase = .probeFailed(reason)
        }
    }

    private func submit() {
        guard !submitting, canSubmit else { return }
        Task { await create(settings: requestSettings) }
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
