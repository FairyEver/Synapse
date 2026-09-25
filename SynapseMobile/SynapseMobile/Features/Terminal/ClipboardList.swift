import SwiftUI

/// The reader's own list of what they copied on a computer.
///
/// One view for both places this list appears — the sheet over the session list, and the
/// clipboard segment of the terminal's panel. They show the same rows about the same
/// data, so they are the same code: two implementations would be two places for the
/// gestures, the preview and the clear confirmation to drift apart.
///
/// The row's gestures are the panel's own, deliberately. The row is not a `Button` and
/// the eye is one, because a button inside a button is not something SwiftUI defines —
/// tapping the row copies, tapping the eye only shows, and neither steals the other's
/// taps.
struct ClipboardList: View {
    let entries: [MobileClipboardEntry]
    /// The sheet's navigation title, when there is one to draw. `nil` means the caller
    /// owns the bar: it has a `NavigationStack` of its own around this list, and the
    /// toolbar item below merges into that bar rather than one drawn here.
    let title: String?
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
            ClipboardPreviewSheet(entry: entry)
                .presentationDetents([.fraction(0.32), .medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var list: some View {
        List {
            ForEach(entries) { entry in
                row(entry)
            }
        }
        .listStyle(.insetGrouped)
        // 空态铺在列表**上面**，而不是当作 `List` 里的一行：`ContentUnavailableView`
        // 要的是整块内容区，塞进列表会先被压成一条窄行。
        //
        // 标识符挂在说明那行而不是整个组件上：`ContentUnavailableView` 是容器，
        // 标识符挂在它身上元素类型会变成 other，而用例查的是 `staticTexts[...]`。
        .overlay {
            if entries.isEmpty {
                ContentUnavailableView {
                    Label("还没有可粘贴的内容", systemImage: "doc.on.clipboard")
                } description: {
                    Text("电脑上复制的文本会出现在这里。")
                        .accessibilityIdentifier("clipboard-empty")
                }
            }
        }
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
        HStack(spacing: 8) {
            Text(entry.text)
                // Two lines rather than the sentences' one: what is copied on a computer
                // is usually a command or a paragraph, and the second line is often what
                // tells two similar ones apart.
                .lineLimit(2)
                .truncationMode(.tail)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("clipboard-row-\(entry.id)")

            if copiedId == entry.id {
                Text("已复制")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("clipboard-copied")
            } else {
                Text(relativeLabel(entry))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }

            Button {
                Haptics.select()
                previewing = entry
            } label: {
                Image(systemName: "eye")
                    .font(.system(size: 19))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    // 画的是 30×30，能点的是 44×44。加在画完之后：圆圈大小不变，长的
                    // 只有可点的框——`Metrics.minimumTapTarget` 是手指的下限。
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("看全文")
            .accessibilityIdentifier("clipboard-preview-\(entry.id)")
        }
        // The whole row is the target, text, time and empty space alike.
        .contentShape(Rectangle())
        .onTapGesture {
            // The buzz belongs to whatever performs the copy, not here: this view does not
            // touch the pasteboard and must not pretend it did. What it does own is saying
            // so on the row itself.
            onCopy(entry)
            // Moves rather than stacks: two rows claiming to be the last one copied would
            // be a lie about which.
            copiedId = entry.id
        }
    }
}

/// One copied item, in full, read-only.
///
/// The answer to the row's truncation: whether this is the text the reader wants is
/// usually decided by the part that did not fit.
///
/// No copy button, deliberately — the same choice `PhrasePreviewSheet` makes. The row
/// behind already does that, and a second way in would make reading an item an act with
/// consequences.
private struct ClipboardPreviewSheet: View {
    let entry: MobileClipboardEntry

    var body: some View {
        ScrollView {
            Text(entry.text)
                .font(.body)
                // Ordinary selectable text, so the system supplies long-press selection
                // and copy. That is the whole interaction: the only thing to do with a
                // copied line here is read it, and with a part of it, take it.
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                // Room for the sheet's drag indicator, which draws over this content
                // rather than above it — the same clearance the phrase preview takes.
                .padding(.top, 24)
                .padding(.bottom, 16)
                .accessibilityIdentifier("clipboard-preview-text")
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
