import SwiftUI

/// The things the panel can show, in the order the segment control draws them.
///
/// The clipboard comes first because it is the one segment that is always there. The
/// other two are whatever a particular computer has been asked about and has answered;
/// this one is the reader's own list, kept on the phone, and nothing about a computer
/// can take it away.
enum ShortcutPanelSegment: String, CaseIterable, Identifiable {
    case clipboard
    case commands
    case phrases

    var id: String { rawValue }

    var label: String {
        switch self {
        case .clipboard: return "剪切板"
        case .commands: return "自定义命令"
        case .phrases: return "快捷输入"
        }
    }
}

/// Every command the computer offers, and every sentence it keeps — the whole list at
/// once, rather than the strip that has to be scrolled to be read.
///
/// The bar under the terminal and this panel are two views of one list, deliberately:
/// the bar is for when you know which command you want and want it near your thumb,
/// and the panel is for when you do not remember what you added on the computer. They
/// share the commands rather than the drawing — the bar is a single scrolling line, and
/// this is a sheet that shows everything at once.
///
/// The sentences' segment exists only if the computer said it does. A computer that has
/// sent `mobile.quickPhrases` — with sentences or with none — decides that completely;
/// a computer that has never sent it has not answered, and its segment is left out
/// altogether. That is `TerminalQuickPhrasesState`'s rule, and it is why `phrases` is
/// optional rather than defaulting to empty.
///
/// It is no longer the only segment that can be absent, and it is not a reason for the
/// picker to disappear: the clipboard segment is the reader's own list and the commands
/// segment needs no answer from anybody, so those two are always drawn and the picker
/// still has somewhere to switch. `availableSegments` is where that is decided.
struct TerminalShortcutPanel: View {
    let buttons: [MobileToolbarButton]
    /// `nil` when the computer being viewed has never described its sentences. An empty
    /// array is a computer that has, and has none.
    let phrases: [MobileQuickPhrase]?
    let isRunning: Bool
    /// Runs a command on the computer. The panel is closed by the caller.
    let onRun: (MobileToolbarButton) -> Void
    /// Puts a sentence into the input field, without sending it.
    ///
    /// The difference from `onRun` is the whole reason the two segments are not one
    /// list. A command is an act; a sentence is text, and text belongs somewhere the
    /// reader can carry on editing it — so it lands in the composer, the panel closes,
    /// and whether it is sent, and when, stays the reader's decision.
    let onInsert: (MobileQuickPhrase) -> Void
    /// The text copied on the computer being viewed, newest first.
    ///
    /// Empty rather than optional: this list is the reader's own, kept on the phone, and
    /// a computer never answers "I have no clipboard" for it to be missing from.
    let clipboardEntries: [MobileClipboardEntry]
    /// Puts one of them on this phone's clipboard.
    ///
    /// The panel does not close for this one, unlike the two actions above: copying is
    /// usually followed by picking a second item, and the copy is already confirmed by
    /// the buzz and the notice.
    let onCopyClipboard: (MobileClipboardEntry) -> Void
    /// Empties this computer's list, once the reader has confirmed it.
    let onClearClipboard: () -> Void

    /// Which segment was last looked at, remembered across launches.
    ///
    /// Remembered rather than reset, and *not* corrected when the remembered segment is
    /// empty: swapping the user's own last choice for a different one silently is worse
    /// than letting them see an empty state, because the empty state says why it is
    /// empty and a jump says nothing at all.
    @AppStorage("terminal.shortcutPanel.segment") private var segmentRaw = ShortcutPanelSegment.commands.rawValue

    /// The sentence whose full text is being read, if any.
    @State private var previewing: MobileQuickPhrase?

    private var segment: Binding<ShortcutPanelSegment> {
        Binding(
            get: { ShortcutPanelSegment(rawValue: segmentRaw) ?? .commands },
            set: { segmentRaw = $0.rawValue }
        )
    }

    /// Which segments this computer's answers make meaningful.
    ///
    /// The clipboard and the commands are always among them — one is the reader's own
    /// list and the other needs no answer from anybody. The sentences are the only
    /// conditional one, and leaving their segment out entirely is what keeps "this
    /// computer has none" apart from "this computer has never been asked": the second
    /// one has no segment to tap, so it cannot be misread as the first.
    private var availableSegments: [ShortcutPanelSegment] {
        phrases == nil ? [.clipboard, .commands] : [.clipboard, .commands, .phrases]
    }

    /// What to draw, given what the computer answered.
    ///
    /// Only the sentences can be unavailable, so a remembered "phrases" from a previous
    /// computer falls back to the first segment rather than leaving the panel blank.
    private var shown: ShortcutPanelSegment {
        segment.wrappedValue == .phrases && phrases == nil ? .clipboard : segment.wrappedValue
    }

    var body: some View {
        // 导航栏是这个面板自己带的，因为「清空」这类作用于整段列表的动作，iOS 只给了
        // 工具栏这一个位置。它由剪切板那一段并进来（见 `ClipboardList`），所以栏本身
        // 画在这里。
        NavigationStack { panel }
            // The sheet's own base is the grouped grey, and it is set out here rather than
            // inside either section so that switching segments cannot change it — and so that
            // the bar, which draws over nothing of its own, has the same grey behind it as the
            // list below. It is also what the command pills stand on: their resting fill is the
            // plain background, and on a plain sheet they would have no edge at all.
            .background(Color(uiColor: .systemGroupedBackground))
            // Fixed detents rather than a height that follows the content: switching segments
            // must not move the sheet, and a sheet sized to its content would jump every time
            // a shorter segment was chosen.
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            // A second sheet over this one rather than a replacement for it, so closing the
            // preview comes back to the panel still open and still on the same segment — the
            // reader was looking at one sentence, not leaving the list.
            .sheet(item: $previewing) { phrase in
                PhrasePreviewSheet(phrase: phrase)
                    // 从贴合内容的高度起，而不是半屏。一句话通常只有一两行，半屏的弹窗会
                    // 有九成是空的 —— 用户看到的是「一句话浮在一大片灰里」。往上拖还是能
                    // 到半屏和全屏，长句子照样读得完（内容是滚动视图）。
                    .presentationDetents([.fraction(0.32), .medium, .large])
                    .presentationDragIndicator(.visible)
            }
    }

    /// 正显示的那一段。
    ///
    /// 分段器不在这里 —— 它在栏上（见 `picker`），所以这一块起手就是列表。
    private var panel: some View {
        VStack(spacing: 0) {
            switch shown {
            case .clipboard: clipboard
            case .commands: commands
            case .phrases: phraseList
            }
        }
        .toolbar {
            // 分段器放在栏里，而不是自己占一行。两个理由，第二个是这一版才量出来的：
            //
            // 一、它是这一整张弹窗的导航方式，系统里同类的东西都长在栏上；
            // 二、栏在**没有工具项时会自己收起来**。上一版把分段器留在栏下面，于是只有
            // 剪切板那一段有「清空」这一项、另外两段是空的 —— 切过去时整条栏塌掉，分段
            // 器和列表一起上跳 67pt，还贴到拖条上。分段器常驻，栏就常驻。
            //
            // 摆中间是量过的结果，不是随手写的：`.topBarLeading` 拿不到宽度，三个标签
            // 会被压成一小块（只剩「剪」字和几个竖条）。居中要付的代价是，系统在**剩下
            // 的空间**里居中，于是「清空」在不在场上，分段器会左右挪 40pt —— 三段里只
            // 有剪切板那一段有它，切换时会看到这一下。
            ToolbarItem(placement: .principal) { picker }
        }
    }

    /// 三段之间的开关。
    ///
    /// Drawn even for a computer that has never described its sentences: two of the three
    /// segments are always meaningful, so there is somewhere to switch from and somewhere
    /// to switch to.
    private var picker: some View {
        Picker("", selection: segment) {
            ForEach(availableSegments) { option in
                Text(option.label).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("shortcut-panel-segment")
    }

    // MARK: - 剪切板

    /// What the reader copied on this computer, for them to copy again here.
    ///
    /// A shared view rather than a third list written out in this file: the same rows,
    /// the same two gestures and the same clear confirmation are drawn by the sheet over
    /// the session list, and one implementation is one place for them to stay in step.
    /// Its title is `nil` — the bar it lands in already holds the segmented control, and a
    /// title beside it would be a second header saying nothing new. The 清空 that comes with
    /// the list lands in that same bar.
    private var clipboard: some View {
        ClipboardList(
            entries: clipboardEntries,
            title: nil,
            onCopy: onCopyClipboard,
            onClear: onClearClipboard,
        )
    }

    // MARK: - 快捷命令

    /// The commands **the user added themselves**, one per row — the shape the sentences
    /// take one segment over.
    ///
    /// The built-ins are deliberately not here. They sit at the leading edge of the bar,
    /// one short swipe away and right against the terminal, so reaching them already
    /// costs almost nothing — while this panel exists for the opposite problem: "I do not
    /// remember what I added on the computer." Listing the built-ins alongside would push
    /// the real answer further down the screen for no gain, which is also why the segment
    /// is named after what it actually holds.
    ///
    /// One row each, one line each. They were a two-column grid at first, on the argument
    /// that command labels are short and a grid shows more at once — an argument that does
    /// not survive a real list, since 「提交开发测试部署」 is an entirely ordinary name and
    /// it wraps inside its cell, making that row twice the height of the one beside it.
    ///
    /// Tinted rather than plain, unlike the sentences: these run something, and every iOS
    /// list says so the same way.
    private var commands: some View {
        List {
            if !customCommands.isEmpty {
                ForEach(customCommands) { button in
                    Button(button.label) {
                        Haptics.select()
                        onRun(button)
                    }
                    // One line always, ellipsised at the tail, for the reason the
                    // sentences are: a label allowed to wrap would make one row taller
                    // than its neighbours.
                    .lineLimit(1)
                    .truncationMode(.tail)
                    // Greyed by the system rather than by an opacity of ours, so a
                    // stopped terminal looks like every other disabled row.
                    .disabled(!isRunning)
                    .accessibilityIdentifier("shortcut-\(button.id)")
                }
            }
        }
        .listStyle(.insetGrouped)
        // 空态铺在列表上面：`ContentUnavailableView` 要的是整块内容区，塞进 `List`
        // 会先被压成一条窄行。标识符挂在说明那行——它才是用例查的 `staticTexts`，
        // 挂在容器上元素类型会变成 other。
        .overlay {
            if customCommands.isEmpty {
                ContentUnavailableView {
                    Label("还没有自定义快捷命令", systemImage: "terminal")
                } description: {
                    Text("在电脑端添加的快捷命令会出现在这里。")
                        .accessibilityIdentifier("shortcut-commands-empty")
                }
            }
        }
    }

    /// What this segment is for: the commands the user put on their computer themselves.
    ///
    /// `custom` and nothing else. The bar's own grouping rule — a separator wherever the
    /// computer's list changes kind — is about drawing one continuous line of buttons;
    /// here it would only be a way of re-admitting the built-ins that were just taken out.
    private var customCommands: [MobileToolbarButton] {
        buttons.filter { $0.group == .custom }
    }


    // MARK: - 快捷输入

    private var phraseList: some View {
        List {
            if let phrases, !phrases.isEmpty {
                ForEach(phrases) { phrase in
                    row(phrase)
                }
            }
        }
        // The look of the list is the system's own — row height, corner radius, the
        // separator's inset — rather than a set of numbers written out to imitate it.
        .listStyle(.insetGrouped)
        // 只有「电脑答过、但它没有」才叫空。电脑根本没答过（`phrases == nil`）不是空，
        // 是不知道——那种情况这一段压根不会被画出来，`shown` 会落到剪切板那一段。
        .overlay {
            if let phrases, phrases.isEmpty {
                ContentUnavailableView {
                    Label("还没有快捷输入", systemImage: "text.bubble")
                } description: {
                    Text("在电脑端添加的快捷输入会出现在这里。")
                        .accessibilityIdentifier("shortcut-phrases-empty")
                }
            }
        }
    }

    /// One sentence, and the key that shows the part of it a single line cannot.
    ///
    /// The row is not a `Button`, and the preview key is one. A button inside a button
    /// is not something SwiftUI defines, and the two do different things anyway: tapping
    /// the row puts the sentence in the composer, while the key only shows it. The key
    /// takes its own taps because it is the closer control, so the row's gesture never
    /// sees them.
    private func row(_ phrase: MobileQuickPhrase) -> some View {
        HStack(spacing: 8) {
            Text(phrase.content)
                // One line always, ellipsised at the tail: a sentence allowed to wrap
                // would turn the card into a wall and lose the whole point of the list,
                // which is reading a dozen of them at a glance. What does not fit is
                // what the eye beside it is for.
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                // On the sentence rather than on the row: the row is an `HStack` with a
                // button in it, and `HStack` is not something the accessibility tree has
                // a name for. This is also the element a tap has to land on, which is
                // what makes it the row's address rather than only its label.
                .accessibilityIdentifier("phrase-row-\(phrase.id)")

            Button {
                Haptics.select()
                previewing = phrase
            } label: {
                Image(systemName: "eye")
                    .font(.system(size: 19))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    // 同剪切板那一枚：画 30×30，点 44×44。
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("看全文")
            .accessibilityIdentifier("phrase-preview-\(phrase.id)")
        }
        // The whole row is the target, text and empty space alike — not just the
        // sentence, which is one line of many and often shorter than the row.
        .contentShape(Rectangle())
        .onTapGesture {
            Haptics.select()
            onInsert(phrase)
        }
    }
}

/// One sentence, in full, read-only.
///
/// The answer to the ellipsis in the list: the part a single line could not hold is
/// usually the part that decides whether this is the sentence you wanted.
///
/// No "use this" button, deliberately. The row behind already does that, and a second
/// way in — from a sheet that is meant to be a glance — would make reading a sentence
/// an act with consequences.
private struct PhrasePreviewSheet: View {
    let phrase: MobileQuickPhrase

    var body: some View {
        ScrollView {
            Text(phrase.content)
                .font(.body)
                // Ordinary selectable text, so the system supplies long-press selection
                // and copy. That is the whole interaction: the only thing to do with a
                // sentence here is read it, and the only thing to do with a part of it
                // is take it.
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                // Room for the sheet's drag indicator, which is drawn over this content
                // rather than above it — the same clearance the panel itself takes, and
                // for the same reason. Without it the sentence starts underneath the
                // grabber.
                .padding(.top, 24)
                .padding(.bottom, 16)
                .accessibilityIdentifier("phrase-preview-text")
        }
    }
}
