import SwiftUI

/// The reader's own list of what they copied on a computer.
///
/// One view for both places this list appears — the sheet over the session list, and the
/// clipboard segment of the terminal's panel. They show the same rows about the same
/// data, so they are the same code: two implementations would be two places for the
/// gestures, the preview and the clear confirmation to drift apart.
///
/// Copy and preview are separate buttons in one row. Both actions remain available to
/// VoiceOver and keyboard users without nesting buttons.
struct ClipboardList: View {
    let entries: [MobileClipboardEntry]
    /// The sheet's navigation title, when there is one to draw. `nil` means the caller
    /// owns the bar: it has a `NavigationStack` of its own around this list, and the
    /// toolbar item below merges into that bar rather than one drawn here.
    let title: String?
    /// 列表头上那台电脑的名字。`nil` 不画头。
    ///
    /// 剪贴板是按电脑分桶的，而主页那一页不显示电脑选择器 —— 头里这个名字是读者唯一能
    /// 看出「现在读的是哪一台的」的地方。终端快捷面板那一份传 `nil`：面板本来就在某台
    /// 电脑的一个会话里，不必再问是哪一台。
    let desktopName: String?
    /// Puts one entry on this phone's clipboard.
    let onCopy: (MobileClipboardEntry) -> Void
    /// Empties this computer's list. Called only once the reader has confirmed.
    let onClear: () -> Void

    @State private var previewing: MobileClipboardEntry?
    @State private var confirmingClear = false
    /// The item last copied, whose row says so.
    ///
    /// In the row rather than only in the banner the app raises for it: the reader's eyes
    /// are on the row they just tapped, and the banner is drawn at the bottom of the
    /// sheet where their hand already is.
    ///
    /// It stays until another row is copied rather than fading on a timer. Two reasons,
    /// and neither is about the test that reads it: the row is the reader's own record of
    /// what they just took, which is worth more while they are still choosing than a
    /// flash they may have looked away from — and a row that says 已复制 cannot be
    /// mistaken for one they have not tapped yet. Leaving the panel is what clears it,
    /// because the panel is rebuilt when it is presented again.
    @State private var copiedId: String?

    var body: some View {
        Group {
            if let title {
                // 标题与它唯一的动作属于导航栏。系统给弹窗顶部留了一条拖条的带子，导
                // 航栏画在那条带子下面；上一版是压在弹窗最顶上的一个手写 `HStack`，
                // 「剪贴板」「清空」和拖条挤在同一条 5pt 高的横带里，字还顶着弹窗的
                // 上圆角 —— 放大截图能量到：字的墨迹顶边距弹窗顶边 4pt，拖条占
                // 2.3–7pt，两者重叠了 3pt。系统的弹窗里没有一处长这样。
                //
                // 这是本仓库另一个带标题的弹窗 `RenameSessionSheet` 已经在用的写法。
                NavigationStack {
                    list
                        .navigationTitle(title)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) { clearButton }
                        }
                }
            } else {
                // 终端面板：导航栏由面板给（`TerminalShortcutPanel` 的 `NavigationStack`），
                // `.toolbar` 会并进那一条。清空是整段列表的动作，工具栏就是它在系统里的
                // 位置 —— 上一版把它画成贴在内容区右边缘的一行裸文字，没有 tint 也没有
                // 按钮外观，看着像静态文本；而它触发的是一次不可撤销的删除。
                list.toolbar {
                    ToolbarItem(placement: .topBarTrailing) { clearButton }
                }
            }
        }
        .alert("清空剪贴板记录？", isPresented: $confirmingClear) {
            Button("取消", role: .cancel) {}
            // 破坏性样式：这一步在手机上是不可撤销的，而它清掉的正是读者可能还要用的东西。
            Button("清空", role: .destructive) { onClear() }
        } message: {
            // 不说条数：这里可能是三条，也可能是五十条，而一个写死的数字会让读者以为
            // 自己记错了。要说清的是范围与代价——删的是这台电脑那一份，电脑不受影响。
            Text("这台电脑的记录会被删掉，电脑不受影响。")
        }
        // A sheet over whatever presented this, rather than a replacement for it, so
        // closing the preview comes back to the list still open and still scrolled —
        // the reader was looking at one item, not leaving the list.
        .sheet(item: $previewing) { entry in
            TextPreviewSheet(text: entry.text, accessibilityIdentifier: "clipboard-preview-text")
                .presentationDetents([.fraction(0.32), .medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var list: some View {
        List {
            // 一行不落地包在 `Section` 里，是因为头只能挂在 Section 上。`desktopName`
            // 为 `nil` 时这个 header 是空视图，系统不画那一条 —— 面板那一份的渲染不变。
            Section {
                ForEach(entries) { entry in
                    row(entry)
                }
                if entries.isEmpty {
                    // Keep the empty state after the computer header in the list's layout.
                    ContentUnavailableView {
                        Label("还没有可粘贴的内容", systemImage: "doc.on.clipboard")
                    } description: {
                        Text("电脑上复制的文本会出现在这里。")
                            .accessibilityIdentifier("clipboard-empty")
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            } header: {
                if let desktopName {
                    Text(desktopName)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(uiColor: .systemBackground))
    }

    /// Greyed rather than hidden, which is what the meetings detail page does: a control
    /// that vanishes is a control the reader has to hunt for the next time, and an empty
    /// list is exactly when they might wonder whether this one exists.
    private var clearButton: some View {
        Button("清空") { confirmingClear = true }
            .disabled(entries.isEmpty)
            .accessibilityIdentifier("clipboard-clear")
    }

    private func row(_ entry: MobileClipboardEntry) -> some View {
        let timeLabel = relativeLabel(entry)
        return HStack(spacing: 12) {
            Button {
                onCopy(entry)
                copiedId = entry.id
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.text)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .font(.body)

                    if copiedId == entry.id {
                        Label("已复制", systemImage: "checkmark")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if !timeLabel.isEmpty {
                        Text(timeLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(entry.text)
            .accessibilityValue(copiedId == entry.id ? "已复制" : "")
            .accessibilityHint("复制到手机剪贴板")
            .accessibilityIdentifier("clipboard-row-\(entry.id)")

            Button {
                Haptics.select()
                previewing = entry
            } label: {
                Text("全文")
                    .font(.subheadline)
                    .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("看全文")
            .accessibilityIdentifier("clipboard-preview-\(entry.id)")
        }
    }
}

/// Read-only full text shared by clipboard history and quick phrases.
struct TextPreviewSheet: View {
    let text: String
    let accessibilityIdentifier: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .accessibilityIdentifier(accessibilityIdentifier)
            }
            .navigationTitle("全文")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }
}

/// How a row's moment reads.
///
/// The first two tiers are not decoration: this list is mostly read in the seconds after
/// something was copied — the reader is holding the phone because they want that text
/// now — so 「刚刚」 answers the only question they have. Past an hour the exact minute
/// stops mattering and a date starts to be what the reader needs.
private func relativeLabel(_ entry: MobileClipboardEntry, now: Date = Date()) -> String {
    guard let copied = entry.copiedAtDate else { return "" }
    let age = now.timeIntervalSince(copied)
    if age < 60 { return "刚刚" }
    if age < 3_600 { return "\(Int(age / 60)) 分钟前" }

    let calendar = Calendar.current
    let formatter: DateFormatter
    if calendar.isDateInToday(copied) {
        formatter = ClipboardTimeFormatter.today
    } else if calendar.isDateInYesterday(copied) {
        formatter = ClipboardTimeFormatter.yesterday
    } else {
        formatter = ClipboardTimeFormatter.dated
    }
    return formatter.string(from: copied)
}

/// The three shapes a row's moment can take, each built once.
///
/// Built here rather than inside the label: `DateFormatter` loads locale and calendar
/// data when it is made, which costs far more than formatting with it, and every row of
/// this list was making its own on every redraw. The three instances are configured once
/// and only ever asked to format afterwards, which is what makes sharing them safe —
/// nothing mutates one after it is built, and formatting with a configured formatter is
/// thread-safe. Same reasoning, and the same shape, as `ISO8601DateFormatter.wire`.
private enum ClipboardTimeFormatter {
    static let today = make("今天 HH:mm")
    static let yesterday = make("昨天 HH:mm")
    static let dated = make("M 月 d 日 HH:mm")

    private static func make(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = format
        return formatter
    }
}
