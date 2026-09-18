import SwiftUI
import UIKit

/// One terminal, full screen.
struct TerminalScreen: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    let sessionId: String
    @State private var draft = ""
    /// Follows the density in force for this session rather than being held as view
    /// state: it is a setting, and a copy here is how the two drift apart.
    private var fontSize: CGFloat { display.density(for: sessionId).fontSize }
    @State private var showingRename = false
    @State private var renamingTitle = ""
    @State private var showingStopConfirm = false
    @State private var keyboardPanelPresented = false
    /// Whether the command panel is open. The bar's right-hand key owns this, and the
    /// panel that reads it is presented as a sheet at the end of the screen.
    @State private var shortcutPanelPresented = false
    @FocusState private var inputFocused: Bool

    @State private var showingPhotoPicker = false
    @State private var showingDocumentPicker = false
    @State private var showingCamera = false
    /// Refreshed at the moments an image can have arrived rather than read where it
    /// is used: the pasteboard changes while the app is not looking, there is no
    /// notification for that, and the menu that asks is built before it opens.
    @State private var pasteboardHoldsImage = false
    /// Files picked but not yet sent, while the user is being asked whether a
    /// terminal that is waiting for input should really receive them.
    @State private var pendingFiles: [PickedFile] = []
    @State private var showingBusyConfirm = false
    @State private var voice = VoiceInputController()
    /// 输入栏现在是哪一种模式。语音不是栏上的一个按钮，而是这条栏的一个状态
    /// （设计文档 §3.2），所以它由这一格决定 —— 四个位置在两种模式下都不搬家。
    @State private var voiceMode = false
    /// 手指是否还压在「按住 说话」那一格上。
    ///
    /// `DragGesture` 只给按下、拖动、松开三种回调，「按下」在这一串里就是**第一次**
    /// `onChanged` —— 没有单独的 down 事件，所以这个闩得自己记。
    @State private var holdLatched = false
    /// 这次按住现在算哪一态。视图只负责把坐标喂进 `HoldToTalkGesture`，判定不在
    /// 这里（设计文档 §6）。
    @State private var holdZone: HoldToTalkGesture.Outcome = .speaking
    /// 收尾只能走一次。失败可能与松手撞在一起，两个 `confirm()` 同时进来会把这段
    /// 录音提交两遍。
    @State private var settlingVoice = false
    /// 识别为空之后输入框顶上要显示的那句话（§5.3）。
    ///
    /// 它跟着输入框，而不是弹一条提示条：「没听到」不是一个需要被知道的事件，是一句
    /// 就地的说明，下一个动作就把它抹掉。
    @State private var emptyVoiceMessage: String?
    /// 锁定态：输入栏长高到三行，以及这件事对桌面网格该不该有影响。
    ///
    /// 两件事合成一个值，是因为它们本来就是一件事的两面 —— 分开写，两个地方总有
    /// 一处会忘记跟着另一边走。
    @State private var voiceGrid = VoiceGridHold()

    private var store: TerminalStore { model.store(for: sessionId) }
    private var session: MobileSummarySession? { model.session(sessionId) }

    /// Only a running terminal can be typed into, and the bar and the panel both say so
    /// by greying out together rather than each deciding for itself.
    private var isRunning: Bool { session?.isRunning == true }

    /// The buttons the computer under this terminal offers, or the built-in fallback
    /// when it is too old to have said. See `SynapseAppModel.activeToolbarButtons`.
    private var buttons: [MobileToolbarButton] { model.activeToolbarButtons }

    /// Files on their way to the computer from this terminal, and the ones that
    /// arrived recently enough to be worth undoing.
    private var relayAttachments: [TerminalAttachment] {
        model.relayAttachments.filter { $0.sessionId == sessionId }
    }

    /// Only this terminal's. A refusal belongs to the session it came from, so it is
    /// not carried across a switch to be shown against a different screen.
    private var terminalMessages: [TerminalMessage] {
        model.terminalMessages.filter { $0.sessionId == sessionId }
    }

    private var modeBinding: Binding<TerminalDisplayMode> {
        Binding(
            get: { display.mode(for: sessionId) },
            set: { display.setMode($0, for: sessionId) }
        )
    }

    /// Optional-tagged so "follow the system setting" is a choice the picker can
    /// show rather than an absence it cannot.
    private var sessionDensityBinding: Binding<TerminalDensity?> {
        Binding(
            get: { display.isOverridingDensity(sessionId) ? display.density(for: sessionId) : nil },
            set: { display.setDensity($0, for: sessionId) }
        )
    }

    private var displayMode: TerminalDisplayMode { display.mode(for: sessionId) }

    /// What the desktop last said its grid is. Absent until the first summary
    /// arrives, and the desktop-grid mode cannot be honoured without it.
    private var desktopGrid: DesktopGrid? {
        guard let session, session.cols > 0, session.rows > 0 else { return nil }
        return DesktopGrid(columns: session.cols, rows: session.rows)
    }

    /// Tells the desktop which grid to adopt, or that it may decide again.
    ///
    /// The view is what wraps the rows — it is the only thing that can see both the
    /// pane and the mode — so there is nothing to push into the store here.
    private func syncDisplayMode() {
        if displayMode == .phoneDriven {
            reportGridToDesktop()
        } else {
            // The desktop's own layout decides again from here, and restores the PTY to
            // its shape as part of this call. The phone has no way to name the size the
            // desktop would have chosen — all it ever heard is the size the PTY
            // currently has, which is the phone's.
            //
            // What the desktop answers decides where the mode ends up, and that rule
            // lives in `applyGridRelease` rather than here: it is about the protocol,
            // not about layout, and it has to be testable without a view.
            Task {
                let outcome = await model.releaseGrid(for: sessionId)
                applyGridRelease(outcome, for: sessionId, to: display)
            }
        }
    }

    /// Tells the desktop which grid to adopt, when the reader has asked the phone to
    /// drive the size.
    ///
    /// Skipped while a keyboard of this phone's is up — the system one, or the panel.
    /// Both shrink the pane, and reporting that shrink would resize the PTY every time
    /// someone tapped the input or opened the panel: a redraw on the computer for a
    /// keyboard it cannot see. The size that stands is the one measured before the
    /// keyboard came up, and the closing of either reports the size again.
    private func reportGridToDesktop() {
        guard displayMode == .phoneDriven, !inputFocused, !keyboardPanelPresented,
              store.visibleRows > 0 else { return }
        let grid = DesktopGrid(columns: store.columns, rows: store.visibleRows)
        // 锁定态进出那两次高度变化都不该进桌面（§4.9）。判定在 `VoiceGridHold` 里，
        // 单测逐条走完 —— 留在这里就只能靠人盯着电脑屏幕看。
        guard voiceGrid.shouldReport(grid) else { return }
        model.setGridSize(grid, for: sessionId, deviceLabel: UIDevice.current.name)
    }

    // MARK: - Keyboards

    /// Puts away whichever keyboard this screen has up.
    ///
    /// The one entry point for it, because there is one rule: this screen has two
    /// keyboards and neither is allowed up while the other is. Tapping the canvas,
    /// tapping the input, and the keyboard button when it is already open all mean the
    /// same thing. Written out at each site instead, the copies drift, and the one that
    /// gets forgotten leaves a keyboard on screen with nothing left that closes it.
    private func dismissKeyboards() {
        inputFocused = false
        keyboardPanelPresented = false
    }

    /// The keyboard button is a switch between the two keyboards, not a way in.
    ///
    /// It did not have a second press to answer while the panel was a sheet, because a
    /// sheet covered the button that had raised it. Sitting in the layout, the button
    /// stays where it was and is reachable again — which is how a keyboard button
    /// behaves everywhere else on the system.
    private func toggleKeyboardPanel() {
        guard !keyboardPanelPresented else {
            dismissKeyboards()
            return
        }
        // Lowered before the panel rises rather than after, so that the two are never
        // both up: with both, the lower one cannot be reached.
        inputFocused = false
        keyboardPanelPresented = true
    }

    /// The toggle at the left end of the input bar: typing, or talking.
    ///
    /// Leaving is unconditional — a mode nothing is happening in has to be escapable.
    /// Coming back is where the two things that would make the mode useless get asked
    /// about, so a press that cannot record changes nothing at all (设计文档 §3.8).
    private func toggleVoiceMode() {
        guard !voiceMode else {
            voiceMode = false
            return
        }
        Task { await enterVoiceMode() }
    }

    private func enterVoiceMode() async {
        // 权限在这个动作里问，因为用户正好是要说话：首次会弹系统授权框，这是对的
        // 时候（§3.8）。按住式下「按下去才发现不可用」是白按一次。
        guard await AudioCapture.requestPermission() else {
            model.raiseTerminalMessage(
                HoldToTalkPresentation.microphoneDeniedNotice,
                sessionId: sessionId,
                id: "voice.notice",
                opensSettings: true
            )
            return
        }
        // 「语音识别未配置」不进预检：它是平台侧的配置问题，唯一能自救的人是部署方，
        // 预检它只是白搭一次网络往返（§3.8）。它留给真正去签名的那一刻。
        if case .noServer = model.connectivity {
            model.raiseTerminalMessage(
                VoiceInputController.Failure.network.message,
                sessionId: sessionId
            )
            return
        }
        // 两个键盘和这个模式不能同时在：它们都会盖住手指马上要按住的那一格。
        dismissKeyboards()
        voiceMode = true
    }

    // MARK: - 说完之后

    /// 松手之后：收尾 → 落地 → 回键盘态。
    ///
    /// 录音中途断网和来电打断也走这里。它们**不给控制器加方法** —— `confirm()` 本来
    /// 就返回「要落进输入框的文本」，`.failed` 和 `.interrupted` 两种状态下都会把已经
    /// 识别到的字交出来，所以视图只需要按原因浮一条提示（§5.2、§5.5）。
    private func settleVoice() async {
        guard !settlingVoice else { return }
        settlingVoice = true
        defer {
            settlingVoice = false
            // 锁到这里才放。收尾中这条栏还是高的 —— §4.6 要的是「拿到结果、文字落定、
            // 回键盘态」在同一个渲染里发生，早一步把栏收回去就成了两段感，而且会先
            // 闪一下语音态那条栏。失败与中断也走这里（§5.2、§5.5）。
            voiceGrid.unlock()
        }

        // 按下不足 200ms：`start()` 是异步的（要签名、起采集），松手时可能还没进录音
        // 态。这不是「没听到」，是手滑了一下（§5.7）。
        guard voice.phase != .idle else {
            voice.cancel()
            return
        }

        // 原因要在收尾之前读出来 —— `confirm()` 会把 `phase` 抹回 idle，那之后就看
        // 不出刚才是断网还是说完了。
        let notice = voiceInterruption()
        let heard = await voice.confirm()
        voiceMode = false

        guard let heard else {
            // `confirm()` 空手而归会把控制器留在 `.failed(.noSpeech)`，而 `start()` 只
            // 在 `.idle` 时才接活 —— 不把它收回来，下一次按住将什么都不会发生。
            let heardNothing = voice.phase == .failed(.noSpeech)
            voice.cancel()
            // 「没听到」和「录不下去了」是两件事。原因已经浮在提示条上了，再补一句
            // 「没有听到声音」是两句话打架（§5.2）—— 识别未配置时文本必然为空，这条
            // 挡的主要就是它。
            if heardNothing, notice == nil {
                emptyVoiceMessage = VoiceInputController.Failure.noSpeech.message
            }
            if let notice { model.raiseTerminalMessage(notice, sessionId: sessionId) }
            return
        }

        land(VoiceLanding.resolve(transcript: heard, draft: draft))
        if let notice { model.raiseTerminalMessage(notice, sessionId: sessionId) }
    }

    /// 这次录音是被什么打断的。nil 表示用户自己说完松的手。
    ///
    /// 三条原因原样复用 `VoiceInputController.Failure.message`，不新编同义句（§4.8）。
    private func voiceInterruption() -> String? {
        switch voice.phase {
        case .failed(let failure): return failure.message
        case .interrupted: return HoldToTalkPresentation.interruptedNotice
        default: return nil
        }
    }

    /// 转写该往哪里落（§4.7）。
    ///
    /// 松手那条与锁定态「确定」那条都走它 —— 写两份分流必然会漂开。
    private func land(_ landing: VoiceLanding) {
        switch landing {
        case .send(let text):
            Haptics.commit()
            send(text)
        case .append(let text):
            Haptics.commit()
            draft = text
        case .nothing:
            break
        }
    }

    var body: some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            navigationBar
            TerminalTextView(
                store: store,
                fontSize: fontSize,
                displayMode: displayMode,
                desktopGrid: desktopGrid,
                revision: store.renderRevision,
                onRequestHistory: { model.requestHistory(sessionId) },
                onTap: { dismissKeyboards() }
            )
            .background(Theme.terminalBackground)
            .onAppear { syncDisplayMode() }
            .onChange(of: displayMode) { syncDisplayMode() }
            .onChange(of: session?.cols) { syncDisplayMode() }
            .onChange(of: session?.rows) { syncDisplayMode() }
            // Both are measured by the view, so they are what the desktop is asked
            // to adopt. Rotation and a dismissed keyboard both land here.
            .onChange(of: store.columns) { reportGridToDesktop() }
            .onChange(of: store.visibleRows) { reportGridToDesktop() }
            .onChange(of: inputFocused) {
                // Asking for the system keyboard is asking for the other one to go:
                // only one of the two can be up, and this is the only place either is
                // asked for by name. Tapping the field, and the toolbar buttons that
                // type into it, all arrive here.
                if inputFocused { keyboardPanelPresented = false }
                reportGridToDesktop()
                refreshPasteboardImage()
            }
            // Anchored to the canvas rather than to the screen, so the queue clears both
            // the back button above it and the input bar below it. An overlay rather than
            // an inset for a reason particular to this screen: a reserved strip would
            // change `visibleRows`, which is reported to the desktop as a grid size, and a
            // one-second notice would resize the PTY twice.
            .noticeOverlay(model)
            TerminalMessageList(
                messages: terminalMessages,
                onDismiss: { model.dismissTerminalMessage($0) }
            )
            TerminalRelayStrip(
                attachments: relayAttachments,
                onUndo: { model.undoTypedPaths($0) },
                onDismiss: { model.dismissRelay($0) },
                onRetry: { model.retryRelay($0) }
            )
            // One bar, two modes: typing, or talking. Voice is a mode of this bar
            // rather than a button on it, so the four slots hold still and only what
            // the field is changes. The words land in a bubble floating above the bar
            // while a finger is on it, and only come back into the bar itself once the
            // recording is locked. `accessoryBar` above stays live throughout —
            // dictating and pressing return are not mutually exclusive.
            accessoryBar
            inputBar
            // Last, so that everything above it keeps its place and the terminal is
            // what gives up the room — the same bargain the system keyboard makes.
            keyboardPanel
        }
        // The bottom safe area is the input bar's surface, not the canvas's: it is
        // what shows through the keyboard's rounded top corners, and what shows under
        // the bar once the keyboard is down. Filled with the canvas colour it read as
        // two dark corners — the terminal bleeding out from under a bar that no
        // longer shares its colour.
        .background(Color(uiColor: .systemBackground).ignoresSafeArea(edges: .bottom))
        // The canvas keeps its own dark surface — its colours come from the
        // desktop's emulator and the fixed terminal palette, not from the app's
        // theme — while the bars above and below it follow the system. Nothing
        // here pins the colour scheme: a scene-level pin is inherited by the
        // screen that comes next, which is what made leaving the terminal flash
        // from dark to light.
        .navigationBarBackButtonHidden(true)
        // Hiding the navigation bar is what disables the system's edge-swipe back
        // gesture, so restoring it takes the gesture recogniser behind the bar —
        // a different mechanism from a view's own preferences, which the status
        // bar experiment showed are not forwarded.
        .background(InteractivePopGesture())
        .toolbar(.hidden, for: .navigationBar)
        // The terminal is the screen; a tab bar over a soft keyboard only
        // costs vertical space and invites taps by accident.
        .toolbar(.hidden, for: .tabBar)
        .onAppear {
            model.openTerminal(sessionId)
            refreshPasteboardImage()
        }
        // Coming back to the front is how an image copied in another app — or on the
        // computer the user is sitting at — reaches this device's pasteboard while
        // this screen is the one being looked at.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refreshPasteboardImage() }
        }
        .onDisappear {
            // Leaving the screen ends the recording with it: a microphone left open
            // behind a pushed-back list is the kind of thing that only gets noticed
            // from the status bar.
            voice.cancel()
            model.closeTerminal(sessionId)
        }
        .onChange(of: voice.phase) { _, phase in
            // 录音中途断网、或者来电把这次录音打断：手指可能还按着，但这次已经录不
            // 下去了（§5.2、§5.5）。立刻收尾 —— 已经听到的字一个字不丢。
            //
            // `noSpeech` 不在此列：它只是把「没有听到声音」摆出来，麦克风还开着，用户
            // 接着说就能接上。
            switch phase {
            case .failed(.network), .failed(.notConfigured), .interrupted:
                Task { await settleVoice() }
            default:
                break
            }
        }
        .onChange(of: voice.notice) { _, message in
            guard let message else { return }
            // The one refusal here that cannot be acted on inside the app: the
            // microphone is a system permission, so it carries a way to go and grant
            // it. Stable id, because it is the same problem every time it appears.
            model.raiseTerminalMessage(
                message,
                sessionId: sessionId,
                id: "voice.notice",
                opensSettings: true
            )
            voice.notice = nil
        }
        .alert("重命名终端", isPresented: $showingRename) {
            TextField("名称", text: $renamingTitle)
            Button("取消", role: .cancel) {}
            Button("保存") { model.rename(sessionId, to: renamingTitle) }
        }
        .alert("停止这个终端？", isPresented: $showingStopConfirm) {
            Button("取消", role: .cancel) {}
            Button("停止", role: .destructive) { model.stop(sessionId) }
        } message: {
            Text("终端将被停止，未保存的进程状态会丢失。")
        }
        .alert("这个终端正在等待操作", isPresented: $showingBusyConfirm) {
            Button("取消", role: .cancel) { pendingFiles = [] }
            Button("仍然插入") { hand(pendingFiles, confirmed: true) }
        } message: {
            Text("它正在等你回答一个问题或输入密码，插入路径可能被当成回答。")
        }
        .sheet(isPresented: $showingPhotoPicker) {
            PhotoLibraryPicker(
                selectionLimit: AppConfiguration.relayMaxFileCount,
                onPicked: { providers in
                    showingPhotoPicker = false
                    Task { await intake(providers: providers) }
                },
                onCancelled: { showingPhotoPicker = false }
            )
            .ignoresSafeArea()
        }
        .sheet(isPresented: $shortcutPanelPresented) {
            TerminalShortcutPanel(
                buttons: buttons,
                // `nil` is a computer that has never described its sentences, which is
                // not the same as one that has none — see `TerminalQuickPhrasesState`.
                phrases: model.activeQuickPhrases,
                isRunning: isRunning,
                onRun: { button in
                    shortcutPanelPresented = false
                    model.runToolbarButton(button, sessionId: sessionId)
                    inputFocused = true
                },
                onInsert: { phrase in
                    shortcutPanelPresented = false
                    // Into the field and nowhere else. Not sent, because a sentence is
                    // text rather than an act and the user is about to read it back
                    // before deciding; and not focused, because focusing is what raises
                    // the system keyboard — which would cover the terminal at the exact
                    // moment the reader is deciding whether to send.
                    draft = phrase.content
                }
            )
        }
        .sheet(isPresented: $showingDocumentPicker) {
            DocumentPicker(
                onPicked: { urls in
                    showingDocumentPicker = false
                    Task { await intake(urls: urls) }
                },
                onCancelled: { showingDocumentPicker = false }
            )
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker(
                onPicked: { image in
                    showingCamera = false
                    Task { await intake(cameraImage: image) }
                },
                onCancelled: { showingCamera = false }
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - Bars

    private var navigationBar: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    // This bar is one we lay out ourselves, so there is no system
                    // 44pt floor behind the button: the glyph is drawn at 17 and is
                    // handed its own room to be hit in — declared as the shape, or
                    // the room is drawn but not hit.
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("返回")

            VStack(spacing: 1) {
                Text(session?.title ?? "终端")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)
                    Text(statusLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    // Which build of the app is asking. On the status line rather
                    // than a line of its own: it is the number a report quotes back,
                    // not something anyone needs at a glance, and a third line would
                    // cost the terminal a row on every screen. Both texts are held
                    // to one line so a narrow phone truncates this row instead of
                    // wrapping it — a wrap would cost that row anyway.
                    Text("· \(AppVersion.label)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity)

            Menu {
                Picker(selection: modeBinding) {
                    ForEach(TerminalDisplayMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                } label: {
                    Label("显示模式", systemImage: "rectangle.split.2x1")
                }
                // Offered only where it decides anything. The density is a choice
                // about how many columns fit across the pane, and only the
                // phone-driven mode has columns to choose: the desktop-grid mode
                // takes the computer's column count and sizes the cell to fill the
                // pane with it, so a density there would be a control wired to
                // nothing — a reader would move it, see no change, and stop
                // trusting the rest of the menu.
                //
                // The value itself is kept either way, so switching modes does not
                // throw away a choice made in the other one.
                if displayMode == .phoneDriven {
                    Picker(selection: sessionDensityBinding) {
                        Text("跟随系统").tag(TerminalDensity?.none)
                        ForEach(TerminalDensity.allCases, id: \.self) { value in
                            Text(value.label).tag(TerminalDensity?.some(value))
                        }
                    } label: {
                        Label("本会话显示密度", systemImage: "textformat.size")
                    }
                }
                Button {
                    renamingTitle = session?.title ?? ""
                    showingRename = true
                } label: {
                    // 菜单里三行操作不带图标：上面那两组选项本来就只画文字，只有
                    // 这三行各多一个图标，摆在一起是两种样子。选中仍然由系统在对
                    // 勾那一列画出来，不靠图标区分。
                    Text("重命名")
                }
                Button {
                    UIPasteboard.general.string = store.plainText
                    // The one message on this screen that is not a problem. It carries
                    // its own id so copying twice restarts one second rather than
                    // queueing a second confirmation.
                    model.notice("已复制终端输出。", tone: .success, id: "terminal.copied")
                } label: {
                    Text("复制全部输出")
                }
                if session?.isRunning == true {
                    Button(role: .destructive) {
                        showingStopConfirm = true
                    } label: {
                        Text("停止终端")
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 30, height: 30)
                    .background(Color(uiColor: .secondarySystemBackground), in: Circle())
                    // The circle is the control; this is the room around it. Applied
                    // after the background so the circle keeps its own size and only
                    // the tappable box grows to the minimum.
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .tint(.primary)
            .accessibilityLabel("更多")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background {
            Rectangle()
                // Opaque, not a material. A material samples what is behind it,
                // and what is behind here is the dark canvas — which is what
                // turned this bar into a grey gradient in light appearance.
                .fill(Color(uiColor: .systemBackground))
                // Extend through the status bar so the bar and the status bar
                // area are one surface.
                .ignoresSafeArea(edges: .top)
        }
        .overlay(alignment: .bottom) {
            Divider().opacity(0.3)
        }
    }

    /// The computer's own toolbar, mirrored: two fixed keys with the commands between
    /// them.
    ///
    /// The commands are the desktop's — its built-ins and whatever the user added there
    /// — with its separators in the same places. The list is read-only: adding, editing
    /// and deleting a command belong to the computer, and there is deliberately no
    /// pencil here.
    ///
    /// Only the middle scrolls. The whole bar used to be one `ScrollView`, which meant
    /// the key at its leading edge slid off the screen as soon as a user had more than
    /// a few commands — so the one control that opens the keyboard panel became the
    /// one control that could not be found. The two fixed keys are outside the scroll
    /// for the same reason, and they are what gives the scroll its room: they hold
    /// their intrinsic size while the scroll view, having none, takes whatever is left.
    /// At the narrowest iPhone that remainder is still wider than a pill, so the scroll
    /// gives way before either key is ever compressed.
    ///
    /// The two fixed keys are this phone's own and are not the same thing twice:
    /// `⌘` opens the panel of keys the system keyboard cannot express, and `⇧` opens
    /// the full list of commands, which is the answer to having scrolled past the one
    /// you wanted. Neither is disabled with the terminal stopped — a stopped terminal
    /// still has an input field and still has commands worth reading.
    private var accessoryBar: some View {
        HStack(spacing: 8) {
            // 左固定：键盘面板。图标由 ⌨ 换成 ⌘，因为它下面的输入栏左端已经是一颗
            // 键盘 —— 相邻两行同一个图形会被当成同一件事。换的只是脸：它开的还是
            // 原来那个面板，`toggleKeyboardPanel()` 一个字没改。
            Button {
                Haptics.select()
                toggleKeyboardPanel()
            } label: {
                Image(systemName: "command")
                    .font(.system(size: 16))
            }
            .terminalKeyPill()
            .accessibilityLabel("打开键盘")
            .accessibilityIdentifier("toolbar-keyboard")

            divider

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(buttons.enumerated()), id: \.element.id) { index, button in
                        // A separator wherever the computer's own list changes kind —
                        // before the first slash command, and before the user's own —
                        // so the two bars read as the same list rather than merely
                        // similar ones. The group travels with the button precisely so
                        // this needs no rule. It scrolls with the commands because it is
                        // the command list's own structure, not the bar's.
                        if index > 0, buttons[index - 1].group != button.group {
                            divider
                        }
                        Button(button.label) {
                            Haptics.select()
                            model.runToolbarButton(button, sessionId: sessionId)
                            inputFocused = true
                        }
                        .terminalKeyPill()
                        .buttonStyle(.plain)
                        .disabled(!isRunning)
                        .opacity(isRunning ? 1 : 0.4)
                        // Named by the button's own id, which is stable across renames
                        // — a test has to be able to press the same command after its
                        // label changed, and a label is the one thing here that is the
                        // user's.
                        .accessibilityIdentifier("toolbar-\(button.id)")
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
            }
            // Named so a test can scroll it: the commands are wider than the screen once
            // a user has a few, and a control that has been scrolled past is one a test
            // otherwise has to guess its way back to.
            .accessibilityIdentifier("toolbar-scroll")

            divider

            // 右固定：全部指令。面板开着时保持按下态，所以这颗键自己也是「面板在开
            // 着」的那条状态指示 —— 终端在面板后面继续跑，被盖住的正是它的最新几行。
            Button {
                Haptics.select()
                shortcutPanelPresented.toggle()
            } label: {
                Image(systemName: "chevron.up")
                    .font(.system(size: 16))
            }
            .terminalKeyPill(pressed: shortcutPanelPresented)
            .accessibilityLabel("全部指令")
            .accessibilityIdentifier("toolbar-all")
        }
        .padding(.horizontal, 12)
        .background(Color(uiColor: .systemBackground))
    }

    /// The keys the system keyboard cannot express, in the slot the system keyboard
    /// would take.
    ///
    /// A row of the screen rather than a sheet over it, which is the whole difference:
    /// a sheet floats above the layout and hides what is under it, so the toolbar and
    /// the input bar — the two things that say what this screen is doing — went behind
    /// it, and the terminal's newest lines with them. A keyboard is not something you
    /// put in front of a terminal; it is something that takes room from it. Sitting
    /// here, below the input bar, everything above is simply laid out on what is left.
    ///
    /// The panel sends a list rather than a single key because one chord needs two
    /// actions: Alt is an Escape prefix, and both halves have to travel in one intent
    /// for the terminal not to act on the bare Escape in between.
    @ViewBuilder
    private var keyboardPanel: some View {
        if keyboardPanelPresented {
            TerminalKeyboardPanel(isEnabled: isRunning) { actions in
                model.sendKeys(sessionId, actions)
                // The panel stays up — pressing several keys, or holding an arrow, is
                // the ordinary way to use it, and a panel that closed after each one
                // would have to be reopened for each one.
                if actions.contains(.key(.enter)) { model.commitDeliveredAttachments(for: sessionId) }
            }
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(Color(uiColor: .separator))
            .frame(width: 1, height: 16)
    }

    /// The one bar under the terminal, in two modes: typing, or talking.
    ///
    /// Voice is a mode of this bar rather than a button on it (设计文档 §3.2), so both
    /// modes are the same four slots at the same four widths — the toggle, the field,
    /// ＋ and send. Only what the field *is* changes. That is what keeps the toggle
    /// under the same thumb when the mode changes back, and what makes the bar's
    /// height the same in both.
    private var inputBar: some View {
        let presentation = HoldToTalkPresentation(
            phase: voice.phase,
            voiceMode: voiceMode,
            hasDraft: !draft.isEmpty,
            gesture: holdZone,
            locked: voiceGrid.isLocked
        )
        return Group {
            if presentation.locked {
                lockedBar(presentation)
            } else {
                HStack(spacing: 8) {
                    modeToggle(presentation)

                    if presentation.barIsVoice {
                        holdToTalk(presentation)
                    } else {
                        commandField
                    }

                    attachMenu(presentation)

                    sendKey(presentation)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
        // 气泡挂在输入栏上而不是进了 `VStack`：它是浮层，一旦参与布局就会改变终端的
        // 可视高度，进而让 `reportGridToDesktop` 往电脑上报一个错的格子数。
        //
        // 位置靠一个**零高度的框**而不是 `alignmentGuide` 拿到：框的顶边就是这条栏的
        // 顶边（`overlay` 的 `.top`），框自己 0 高，里面的气泡按 `.bottom` 对齐 ——
        // 于是它整个挂在框上方，也就是栏的正上方。`alignmentGuide(.top) { $0[.bottom] }`
        // 在这里不生效：气泡会落在栏的下方，一路顶着屏幕底边跑出去。
        .overlay(alignment: .top) {
            if presentation.bubbleVisible {
                voiceBubble(presentation)
                    .fixedSize()
                    .frame(height: 0, alignment: .bottom)
                    // 它盖在终端上。能点它就等于在终端上多出一块点不到的区域。
                    .allowsHitTesting(false)
            }
        }
    }

    /// 左端常驻的键盘 / 语音切换键。
    ///
    /// 它是这套结构里唯一的锚点，位置永远不变 —— 它动了整套就散了（§3.2）。
    private func modeToggle(_ presentation: HoldToTalkPresentation) -> some View {
        Button {
            Haptics.select()
            toggleVoiceMode()
        } label: {
            Image(systemName: presentation.barIsVoice ? "keyboard" : "mic")
                .font(.system(size: 22))
                .foregroundStyle(Theme.ink)
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .disabled(!presentation.controlsEnabled)
        .opacity(presentation.controlsEnabled ? 1 : 0.4)
        .accessibilityIdentifier("voice-mode-toggle")
        .accessibilityLabel(presentation.barIsVoice ? "切换到键盘" : "切换到语音")
        // 模式报在这一格上，而不是包着四格的 HStack 上：`accessibilityIdentifier`
        // 加在容器上会向下盖掉每一个子元素的标识 —— 那样 `attach` 和 `send` 会连同
        // 它们的测试一起消失，而屏幕上看起来什么都没变。
        .accessibilityValue(presentation.barIsVoice ? "voice" : "keyboard")
    }

    /// 语音态下顶上输入框那一格的东西：按住即录，滑动选态，松手落定。
    ///
    /// 它不是文本域而是按钮，但宽度与位置与文本域逐格一致 —— §8 第 2 条要靠这个过。
    private func holdToTalk(_ presentation: HoldToTalkPresentation) -> some View {
        HStack(spacing: 6) {
            // 两侧的字是手势的图例，按住期间常驻。手指压着中间，字在两边，滑动不用
            // 猜（§4.5）—— 它们跟着手势高亮，所以按住的人知道再滑一点会发生什么。
            if presentation.fieldPressed {
                legend(HoldToTalkPresentation.cancelLegend, ready: presentation.cancelReady, tone: .cancel)
            }

            Text(presentation.fieldLabel)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity)

            if presentation.fieldPressed {
                legend(HoldToTalkPresentation.lockLegend, ready: presentation.lockReady, tone: .lock)
            }
        }
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget)
        .background(
            Color(uiColor: presentation.fieldPressed ? .systemGray5 : .secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
        )
        // 整格都是手势区，而不只是字画到的地方。
        .contentShape(Rectangle())
        .gesture(holdGesture)
        .accessibilityIdentifier("voice-hold")
    }

    /// 手势图例的一端。就绪时反白 —— 手指压着这一格，这是唯一的指示。
    private func legend(
        _ text: String,
        ready: Bool,
        tone: HoldToTalkPresentation.Tone
    ) -> some View {
        Text(text)
            .font(.caption)
            .fontWeight(ready ? .semibold : .regular)
            .foregroundStyle(ready ? Theme.paper : Color.secondary)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(
                ready ? bubbleFill(tone) : Color.clear,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
            )
    }

    /// 按住说话那一格上的手势。
    ///
    /// `DragGesture(minimumDistance: 0)` 一步到位地给了按下、拖动、松开 —— 自己写
    /// UIKit 识别器只会多出一份要和 SwiftUI 布局对齐的状态。
    private var holdGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if !holdLatched { beginHold() }
                let next = HoldToTalkGesture.outcome(translationX: value.translation.width)
                // `onChanged` 每一帧都来，写一次状态就是一次整屏重算。
                if next != holdZone { holdZone = next }
            }
            .onEnded { _ in endHold() }
    }

    private func beginHold() {
        holdLatched = true
        holdZone = .speaking
        // 上一次那句「没有听到声音」到此为止（§5.3）。
        emptyVoiceMessage = nil
        Haptics.record()
        voice.start { await model.requestAsrSignature() }
    }

    /// 松手。
    private func endHold() {
        guard holdLatched else { return }
        holdLatched = false
        let zone = holdZone
        holdZone = .speaking

        switch zone {
        case .cancelling:
            // 取消之后**留在语音态**：多半是想重说一遍，让人再按一次切换键没有道理
            // （§3.3）。`draft` 一个字不改 —— 这一格从来没碰过它。
            voice.cancel()
        case .locking:
            // 手指走了，录音继续：这一格换成录音会话栏，手可以去翻终端（§4.9）。
            voiceGrid.lock(holding: DesktopGrid(columns: store.columns, rows: store.visibleRows))
        case .speaking:
            Task { await settleVoice() }
        }
    }

    /// The command field. A plain field with no microphone beside it: voice moved to the
    /// left end and became a mode, and a second way in would only make people guess
    /// which one is different (设计文档 §3.2).
    private var commandField: some View {
        // 占位会被换成「没有听到声音」。识别为空是一次**就地**的说明，不是一件需要
        // 被知道的事：它落在输入框原来就写着字的地方，动一下键盘就没了（§5.3）。
        TextField(emptyVoiceMessage ?? "输入命令", text: $draft)
            .textFieldStyle(.plain)
            .font(.system(.body, design: .monospaced))
            .frame(minHeight: Metrics.minimumTapTarget)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .submitLabel(.send)
            .focused($inputFocused)
            .onSubmit(sendDraft)
            .onChange(of: draft) { emptyVoiceMessage = nil }
    }

    /// 锁定之后这一格变成一条录音会话栏：`[✗] [录音中 + 转写] [确定]`（§4.9）。
    ///
    /// 这是**唯一允许改几何**的状态。输入栏长高到三行，手机上终端的可视区跟着变矮，
    /// 换来「能回看刚才说了什么」—— 对一段长提示词，这比几行终端输出值。代价由
    /// `reportGridToDesktop` 那一处的守卫处理：本地重排，不向电脑报新的网格。
    private func lockedBar(_ presentation: HoldToTalkPresentation) -> some View {
        HStack(spacing: 8) {
            Button {
                Haptics.select()
                // 「放弃」与「左滑取消」不是一回事：取消是手指还在栏上、多半想重说，
                // 放弃是长录之后主动收摊，接着多半要打字 —— 所以它回键盘态（§4.9）。
                voice.cancel()
                voiceGrid.unlock()
                voiceMode = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.ink)
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .accessibilityIdentifier("voice-lock-discard")
            .accessibilityLabel(HoldToTalkPresentation.lockCancelLabel)

            VStack(alignment: .leading, spacing: 3) {
                // 麦克风还开着这件事不写出来只能靠猜，而它决定的正是「我能不能走开去
                // 做点别的」。
                Text(presentation.lockTitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                lockTranscript(presentation)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color(uiColor: .secondarySystemBackground),
                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
            )

            Button {
                // 收尾与落地交给松手那条同一条路 —— 包括那一次 `Haptics.commit()`
                // （§4.7、§4.9），以及解锁的时机：这条栏要一直挂到结果回来为止。
                Task { await settleVoice() }
            } label: {
                Text(HoldToTalkPresentation.lockConfirmLabel)
            }
            // 实心胶囊：它是一次长输入的落槌，与这条栏上别的键不同一个分量。
            .terminalKeyPill(prominent: true)
            .accessibilityIdentifier("voice-lock-confirm")
        }
    }

    /// 锁定栏中间那三行。手指走了，落点回到输入栏本体（§3.7）。
    private func lockTranscript(_ presentation: HoldToTalkPresentation) -> some View {
        let text: Text
        if presentation.lockText.isEmpty {
            text = Text(verbatim: presentation.placeholder).foregroundStyle(.secondary)
        } else {
            let caret = presentation.lockText.caret
                ? Text(verbatim: "▏").foregroundStyle(Theme.ink)
                : Text(verbatim: "")
            text = Text(presentation.lockText.stable).foregroundStyle(Theme.ink)
                + Text(presentation.lockText.unstable).foregroundStyle(.secondary)
                + caret
        }
        return text
            .font(.system(.footnote, design: .monospaced))
            .lineLimit(3)
            // 永远滚到最新：超出三行时切掉最早说的那句（§4.9）。
            .truncationMode(.head)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("voice-lock-text")
    }

    /// The sources the ＋ offers. It sits beside the field rather than at the far left
    /// now that the toggle owns that end — the same order WeChat uses, and the same
    /// distance from the thumb either way.
    ///
    /// `Menu` builds its contents while the body is being evaluated, which is why
    /// `pasteboardHoldsImage` is kept as state refreshed at the moments the answer can
    /// change — see `refreshPasteboardImage`.
    private func attachMenu(_ presentation: HoldToTalkPresentation) -> some View {
        Menu {
            Button {
                showingPhotoPicker = true
            } label: {
                Label("照片", systemImage: "photo")
            }
            // Hidden where there is no camera — the simulator, and any device
            // without one — rather than offered and then failing.
            if CameraPicker.isAvailable {
                Button {
                    showingCamera = true
                } label: {
                    Label("拍照", systemImage: "camera")
                }
            }
            Button {
                showingDocumentPicker = true
            } label: {
                Label("文件", systemImage: "folder")
            }
            if pasteboardHoldsImage {
                Button {
                    sendPastedImage()
                } label: {
                    Label("粘贴图片", systemImage: "doc.on.clipboard")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22))
                .foregroundStyle(Theme.ink)
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .tint(Theme.ink)
        // Dimmed while a finger is on the field, rather than taken away: the slot keeps
        // its place, so nothing has to be found again afterwards (设计文档 §4.1).
        .disabled(!presentation.controlsEnabled)
        .opacity(presentation.controlsEnabled ? 1 : 0.4)
        .accessibilityIdentifier("attach")
        .accessibilityLabel("添加附件")
    }

    /// The key at the right end. It holds its place in voice mode and fades there: the
    /// words that mode produces are sent on release without passing through this key
    /// (设计文档 §4.3). Nothing is added or moved, so switching back leaves send exactly
    /// where it was.
    private func sendKey(_ presentation: HoldToTalkPresentation) -> some View {
        let enabled = presentation.sendEnabled
        return Button(action: sendDraft) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 30))
                .foregroundStyle(enabled ? Theme.ink : Color.secondary)
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .disabled(!enabled)
        .opacity(presentation.barIsVoice ? 0.4 : 1)
        .accessibilityIdentifier("send")
        .accessibilityLabel("发送")
    }

    // MARK: - 手指上方的气泡

    /// 实时转写与手势提示，浮在输入栏正上方。
    ///
    /// **它是浮层，不进 `VStack` 的布局流** —— 进了就会改变终端的可视高度，`report-
    /// GridToDesktop` 随即往电脑上报一个错的格子数。
    private func voiceBubble(_ presentation: HoldToTalkPresentation) -> some View {
        VStack(spacing: 8) {
            VStack(spacing: 0) {
                bubbleBody(presentation)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        bubbleFill(presentation.bubbleTone),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
                // 朝下的尖，指着按住的那一格。
                BubbleTail()
                    .fill(bubbleFill(presentation.bubbleTone))
                    .frame(width: 14, height: 7)
            }
            // 终端底色是固定深色的，浅色的气泡在深色外观下和它几乎同一个亮度 ——
            // 没有这层抬升，气泡会沉进终端里。
            .shadow(color: .black.opacity(0.18), radius: 10, y: 4)

            Text(presentation.hint)
                .font(.footnote.weight(.medium))
                .foregroundStyle(bubbleLegible(presentation.bubbleTone))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(bubbleFill(presentation.bubbleTone), in: Capsule())
                .accessibilityIdentifier("voice-bubble-hint")
        }
        .frame(maxWidth: 300)
    }

    /// 气泡里的字。两级：已定稿的正常色，还在变的当前句次要色，末尾一个光标（§3.7）。
    private func bubbleBody(_ presentation: HoldToTalkPresentation) -> some View {
        // 取消就绪是红的、锁定就绪是深的，两级文字都得跟着翻过来，否则会落在和自己
        // 一样的底色上。
        let settled = bubbleLegible(presentation.bubbleTone)
        let changing = bubbleEcho(presentation.bubbleTone)

        let text: Text
        if presentation.bubbleText.isEmpty {
            text = Text(verbatim: presentation.placeholder).foregroundStyle(changing)
        } else {
            let caret = presentation.bubbleText.caret
                ? Text(verbatim: "▏").foregroundStyle(settled)
                : Text(verbatim: "")
            text = Text(presentation.bubbleText.stable).foregroundStyle(settled)
                + Text(presentation.bubbleText.unstable).foregroundStyle(changing)
                + caret
        }
        return text
            .font(.system(.body, design: .monospaced))
            .lineLimit(2)
            // 超出两行时从前面截：被切掉的是最早说的那句，最新那句留在屏幕上（§4.4）。
            .truncationMode(.head)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("voice-bubble-text")
    }

    /// 气泡与提示条的底色（§4.5）。用输入栏自己的面色，气泡读起来像是从这条栏浮上去的。
    private func bubbleFill(_ tone: HoldToTalkPresentation.Tone) -> Color {
        switch tone {
        case .normal: return Color(uiColor: .systemBackground)
        case .cancel: return Color(uiColor: .systemRed)
        case .lock: return Theme.ink
        }
    }

    /// 写在那个底色上的正文色。
    private func bubbleLegible(_ tone: HoldToTalkPresentation.Tone) -> Color {
        switch tone {
        // 红底上一律白字：`systemRed` 在两种外观下都是中间调的红，白字都读得出来。
        case .normal: return Theme.ink
        case .cancel: return .white
        case .lock: return Theme.paper
        }
    }

    /// 还在变的那半句：同一根颜色的弱化版，与输入框里那条两级规则一致。
    private func bubbleEcho(_ tone: HoldToTalkPresentation.Tone) -> Color {
        switch tone {
        case .normal: return Color.secondary
        case .cancel: return .white.opacity(0.7)
        case .lock: return Theme.paper.opacity(0.65)
        }
    }

    private func sendDraft() {
        let text = draft
        guard !text.isEmpty else { return }
        // After the guard: a send with nothing to send does nothing, and a tap
        // felt there would say something happened.
        Haptics.commit()
        draft = ""
        send(text)
    }

    /// 发一条给终端。发送键与语音的「松手即发送」共用它 —— 同一条消息不该因为走了
    /// 哪条路而长得不一样。
    private func send(_ text: String) {
        model.sendCommand(sessionId, text: text)
        // The path an inserted file typed goes out with this line, so the chip that
        // carried it has nothing left to undo.
        model.commitDeliveredAttachments(for: sessionId)
    }

    // MARK: - Sending files to the computer

    private func intake(providers: [NSItemProvider]) async {
        var files: [PickedFile] = []
        for provider in providers {
            if let file = await TerminalFileIntake.prepare(imageProvider: provider) {
                files.append(file)
            }
        }
        hand(files)
    }

    private func intake(urls: [URL]) async {
        var files: [PickedFile] = []
        for url in urls {
            if let file = await TerminalFileIntake.prepare(documentURL: url) {
                files.append(file)
            }
        }
        hand(files)
    }

    private func intake(cameraImage: UIImage) async {
        guard let file = await TerminalFileIntake.prepare(cameraImage: cameraImage) else {
            model.raiseTerminalMessage("没有读取到可发送的图片。", sessionId: sessionId)
            return
        }
        hand([file])
    }

    /// Whether the pasteboard holds an image, answered at the few moments the answer
    /// can have changed. `hasImages` talks to the pasteboard service, so it is not
    /// something to ask on every pass of a body that a keystroke already re-runs —
    /// and the menu it feeds cannot ask for itself, being built before it opens.
    private func refreshPasteboardImage() {
        pasteboardHoldsImage = UIPasteboard.general.hasImages
    }

    private func sendPastedImage() {
        // The offer was made from a reading taken earlier, and the pasteboard is
        // the one thing on screen that another app can change underneath it.
        guard let image = UIPasteboard.general.image else {
            model.raiseTerminalMessage("剪贴板里已经没有图片了。", sessionId: sessionId)
            pasteboardHoldsImage = false
            return
        }
        Task {
            guard let file = await TerminalFileIntake.prepare(pastedImage: image) else {
                model.raiseTerminalMessage("没有读取到可发送的图片。", sessionId: sessionId)
                return
            }
            hand([file])
        }
    }

    /// Starts the transfer, or asks first when the terminal is waiting on a person.
    ///
    /// The design's caution, narrowed to where the risk actually is. A terminal in
    /// `waiting` is one an agent has stopped at — an approval, a question, a
    /// password — and the path inserted there can be read as the answer. `unknown`,
    /// the state of every plain shell, is not evidence of anything and asking on it
    /// would put a dialog in front of the common case until the user learned to tap
    /// through it.
    private func hand(_ files: [PickedFile], confirmed: Bool = false) {
        guard !files.isEmpty else {
            model.raiseTerminalMessage("没有读取到可发送的文件。", sessionId: sessionId)
            return
        }
        if !confirmed, session?.attention.isWaiting == true {
            pendingFiles = files
            showingBusyConfirm = true
            return
        }
        pendingFiles = []
        model.sendFiles(files, to: sessionId)
    }

    private var statusLabel: String {
        guard let session else { return model.connectivity.label }
        if session.attention.isWaiting { return "等待确认" }
        return session.isRunning ? "运行中" : "已结束"
    }

    private var statusColor: Color {
        guard let session else { return .secondary }
        return Theme.statusColor(isWaiting: session.attention.isWaiting, isRunning: session.isRunning)
    }
}

/// 气泡下方那个朝下的尖，指着按住的那一格。
///
/// 画成一个平顶的三角形而不是一个旋转的方块：它要和气泡的下边缘严丝合缝地接上，
/// 差一点就是一道缝。
private struct BubbleTail: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// Puts the interactive pop gesture back on a screen that hides its back button.
///
/// The bar is hidden, not absent: the gesture recogniser still exists, it is just
/// switched off with the button. Handing it a delegate of our own turns it back on
/// and lets us say when it may start.
private struct InteractivePopGesture: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        Controller()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        private weak var previousDelegate: UIGestureRecognizerDelegate?
        private weak var gesture: UIGestureRecognizer?

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            guard let gesture = navigationController?.interactivePopGestureRecognizer else { return }
            self.gesture = gesture
            previousDelegate = gesture.delegate
            gesture.delegate = self
            gesture.isEnabled = true
        }

        /// Hands the recogniser back exactly as it was found.
        ///
        /// It is one object shared by the whole navigation controller, so a
        /// delegate left behind would outlive this screen and change how the next
        /// one behaves.
        deinit {
            guard let gesture else { return }
            gesture.delegate = previousDelegate
            gesture.isEnabled = false
        }

        /// Only when there is something to go back to.
        ///
        /// Each tab owns a `NavigationStack`, and at its root there is nothing
        /// behind the screen; the classic failure of this technique is the gesture
        /// recognising there anyway.
        ///
        /// Measured honestly: this gate could **not** be shown to be load-bearing.
        /// The root behaves the same with and without it, because the delegate is
        /// weak and is gone by the time the terminal has been popped. It is kept as
        /// the documented mitigation for a failure that did not reproduce here,
        /// not because it was observed to prevent one.
        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            (navigationController?.viewControllers.count ?? 0) > 1
        }

    }
}
