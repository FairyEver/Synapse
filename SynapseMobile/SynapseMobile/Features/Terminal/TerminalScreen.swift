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
        model.setGridSize(
            DesktopGrid(columns: store.columns, rows: store.visibleRows),
            for: sessionId,
            deviceLabel: UIDevice.current.name
        )
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
    private func toggleVoiceMode() {
        guard !voiceMode else {
            voiceMode = false
            return
        }
        // The two keyboards and this mode cannot share the screen: either would sit
        // over the field the finger is about to cover.
        dismissKeyboards()
        voiceMode = true
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

    /// The computer's own toolbar, mirrored.
    ///
    /// These are the buttons the desktop shows under its terminal — its built-ins and
    /// whatever the user added there — with its separators in the same places. The list
    /// is read-only: adding, editing and deleting a command belong to the computer, and
    /// there is deliberately no pencil here.
    ///
    /// The keyboard button at the front is the one thing that is this phone's own. It
    /// opens the panel holding the keys a bare list of commands cannot express, which is
    /// what the ten fixed keys that used to sit here were for.
    private var accessoryBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button {
                    Haptics.select()
                    toggleKeyboardPanel()
                } label: {
                    Image(systemName: "keyboard")
                        .font(.system(size: 16))
                }
                .terminalKeyPill()
                .accessibilityLabel("打开键盘")
                .accessibilityIdentifier("toolbar-keyboard")

                divider

                ForEach(Array(buttons.enumerated()), id: \.element.id) { index, button in
                    // A separator wherever the computer's own list changes kind — before
                    // the first slash command, and before the user's own — so the two
                    // bars read as the same list rather than merely similar ones. The
                    // group travels with the button precisely so this needs no rule.
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
                    // Named by the button's own id, which is stable across renames —
                    // a test has to be able to press the same command after its label
                    // changed, and a label is the one thing here that is the user's.
                    .accessibilityIdentifier("toolbar-\(button.id)")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
        }
        .background(Color(uiColor: .systemBackground))
        // Named so a test can scroll it: the bar is wider than the screen once a user
        // has a few commands, and a control that has been scrolled past is one a test
        // otherwise has to guess its way back to.
        .accessibilityIdentifier("toolbar-scroll")
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
            hasDraft: !draft.isEmpty
        )
        return HStack(spacing: 8) {
            modeToggle(presentation)

            if presentation.barIsVoice {
                holdToTalk(presentation)
            } else {
                commandField
            }

            attachMenu(presentation)

            sendKey(presentation)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
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

    /// 语音态下顶上输入框那一格的东西。
    ///
    /// 它不是文本域而是按钮，但宽度、高度与位置与文本域逐格一致 —— §8 第 2 条要
    /// 靠这个过。手指按住时的样子与手势图例在下一个文件里接上。
    private func holdToTalk(_ presentation: HoldToTalkPresentation) -> some View {
        Text(presentation.fieldLabel)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(Theme.ink)
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget)
            .background(
                Color(uiColor: .secondarySystemBackground),
                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
            )
            .accessibilityIdentifier("voice-hold")
    }

    /// The command field. A plain field with no microphone beside it: voice moved to the
    /// left end and became a mode, and a second way in would only make people guess
    /// which one is different (设计文档 §3.2).
    private var commandField: some View {
        TextField("输入命令", text: $draft)
            .textFieldStyle(.plain)
            .font(.system(.body, design: .monospaced))
            .frame(minHeight: Metrics.minimumTapTarget)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .submitLabel(.send)
            .focused($inputFocused)
            .onSubmit(sendDraft)
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

    private func sendDraft() {
        let text = draft
        guard !text.isEmpty else { return }
        // After the guard: a send with nothing to send does nothing, and a tap
        // felt there would say something happened.
        Haptics.commit()
        draft = ""
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
