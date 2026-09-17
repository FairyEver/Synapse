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
    /// Skipped while the input has focus. The keyboard shrinks the pane, and
    /// reporting that shrink would resize the PTY every time someone taps the input
    /// — a redraw for a keyboard the desktop cannot see. The size that stands is the
    /// one measured before the keyboard came up.
    private func reportGridToDesktop() {
        guard displayMode == .phoneDriven, !inputFocused, store.visibleRows > 0 else { return }
        model.setGridSize(
            DesktopGrid(columns: store.columns, rows: store.visibleRows),
            for: sessionId,
            deviceLabel: UIDevice.current.name
        )
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
                onTap: { inputFocused = false }
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
            // There used to be a second bar stacked on top of this one while
            // recording. There is one bar now, and it changes parts: the transcript
            // goes where the command field is, ✗ where the ＋ was, ✓ where send was.
            // Nothing moves but the icons, so confirming leaves send under the same
            // finger. `accessoryBar` above stays live throughout — dictating and
            // pressing return are not mutually exclusive.
            accessoryBar
            inputBar
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
                    Label("重命名", systemImage: "pencil")
                }
                Button {
                    UIPasteboard.general.string = store.plainText
                    // The one message on this screen that is not a problem. It carries
                    // its own id so copying twice restarts one second rather than
                    // queueing a second confirmation.
                    model.notice("已复制终端输出。", tone: .success, id: "terminal.copied")
                } label: {
                    Label("复制全部输出", systemImage: "doc.on.doc")
                }
                if session?.isRunning == true {
                    Button(role: .destructive) {
                        showingStopConfirm = true
                    } label: {
                        Label("停止终端", systemImage: "stop.circle")
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
                    // The system keyboard and this panel are both keyboards, and two of
                    // them at once means the lower one cannot be reached. Lowered before
                    // the panel rises rather than after, so they are never both up.
                    inputFocused = false
                    Haptics.select()
                    keyboardPanelPresented = true
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
        .sheet(isPresented: $keyboardPanelPresented) {
            // The panel sends a list rather than a single key because one chord needs
            // two actions: Alt is an Escape prefix, and both halves have to travel in
            // one intent for the terminal not to act on the bare Escape in between.
            TerminalKeyboardPanel(isEnabled: isRunning) { actions in
                model.sendKeys(sessionId, actions)
                // The panel stays up — pressing several keys, or holding an arrow, is
                // the ordinary way to use it, and a panel that closed after each one
                // would have to be reopened for each one.
                if actions.contains(.key(.enter)) { model.commitDeliveredAttachments(for: sessionId) }
            }
            // Its resting height — and therefore its detent — belongs to the page the
            // panel is on, so the panel sets it: the full keyboard is four rows where
            // the others are two or three. See `KeyboardPanelMetrics`.
            .presentationDragIndicator(.visible)
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(Color(uiColor: .separator))
            .frame(width: 1, height: 16)
    }

    /// The one bar under the terminal. Recording does not add a second one: the
    /// transcription takes the command field's place, ✗ takes the ＋'s, ✓ takes
    /// send's, and the microphone slot collapses so the width goes to the words.
    /// The bar's height and the field's width are the same in both states, so the
    /// only thing that changes is what the controls mean.
    private var inputBar: some View {
        let presentation = VoiceInputPresentation(phase: voice.phase, transcript: voice.transcript)
        return HStack(spacing: 8) {
            if presentation.active {
                // ✗ rolls the field back to what it held before the microphone was
                // tapped, so it belongs where the ＋ that started it was.
                Button {
                    Haptics.record()
                    voice.cancel()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.ink)
                        .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("voice-cancel")
                .accessibilityLabel("取消语音输入")
            } else {
                // The sources are offered where the + is, not from the middle of the
                // screen: the list is short, and the hand that opened it is already
                // there. `Menu` builds its contents while the body is being evaluated,
                // which is why `pasteboardHoldsImage` is kept as state refreshed at the
                // moments the answer can change — see `refreshPasteboardImage`.
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
                .accessibilityIdentifier("attach")
                .accessibilityLabel("添加附件")
            }

            if presentation.active {
                transcription(presentation)
            } else {
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

            // The slot collapses while recording instead of greying out: the words
            // need the width, and a second recording is not something to start from
            // inside this one.
            if !presentation.active {
                Button {
                    Haptics.record()
                    // Dropped before the bar swaps: the keyboard would otherwise be
                    // dismissed by a view that no longer exists.
                    inputFocused = false
                    voice.start { await model.requestAsrSignature() }
                } label: {
                    Image(systemName: "mic")
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.ink)
                        .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("voice-start")
                .accessibilityLabel("语音输入")
            }

            rightKey(presentation)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
    }

    /// The live transcription, in the command field's own place.
    ///
    /// `.truncationMode(.head)` is what keeps the newest words on screen: text that
    /// outgrows the width is cut at the front, so the tail — the part just said —
    /// stays visible. A scrolling reader would have to keep scroll state and would
    /// re-lay-out the line every time the unstable half is rewritten.
    ///
    /// The field is a plain display node here, not a hidden-keyboard text field: with
    /// nothing focusable left on screen there is nothing for the keyboard to come up
    /// for.
    private func transcription(_ presentation: VoiceInputPresentation) -> some View {
        let text: Text
        if voice.transcript.isEmpty {
            text = Text(verbatim: presentation.placeholder).foregroundStyle(.secondary)
        } else {
            // Settled text in the normal colour, the current sentence in the secondary
            // one — which half is still going to change has to be visible. The caret
            // is a thin block character rather than a shape: it has to flow with the
            // text so it stays at the end of it, and it does not blink.
            let caret = presentation.caretVisible
                ? Text(verbatim: "▏").foregroundStyle(Theme.ink)
                : Text(verbatim: "")
            text = Text(voice.transcript.stable)
                + Text(voice.transcript.unstable).foregroundStyle(.secondary)
                + caret
        }
        return text
            .font(.system(.body, design: .monospaced))
            .lineLimit(1)
            .truncationMode(.head)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("voice-transcript")
    }

    /// The key at the right end. Nothing is added or moved while recording — only
    /// the icon and its meaning change, so confirming puts send back exactly where
    /// the ✓ was.
    @ViewBuilder
    private func rightKey(_ presentation: VoiceInputPresentation) -> some View {
        switch presentation.right {
        case .send:
            Button(action: sendDraft) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(draft.isEmpty ? Color.secondary : Theme.ink)
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .disabled(draft.isEmpty)
            .accessibilityIdentifier("send")
            .accessibilityLabel("发送")

        case .confirm, .confirmDisabled:
            let enabled = presentation.right == .confirm
            Button {
                Task { await finishVoice() }
            } label: {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(enabled ? Theme.ink : Color.secondary)
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .disabled(!enabled)
            .accessibilityIdentifier("voice-confirm")
            .accessibilityLabel("确认语音输入")

        case .retry, .retryDisabled:
            let enabled = presentation.right == .retry
            Button {
                Haptics.select()
                voice.retry()
            } label: {
                Image(systemName: "arrow.clockwise.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(enabled ? Theme.ink : Color.secondary)
                    .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .disabled(!enabled)
            .accessibilityIdentifier("voice-retry")
            .accessibilityLabel("重试")
        }
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

    /// Voice is only another way of filling `draft` — sending stays the arrow's job.
    private func finishVoice() async {
        guard let text = await voice.confirm() else { return }
        // After the guard, so a confirmation that failed has no tap claiming it
        // worked — the words are what is being announced, not the press.
        Haptics.commit()
        // Appended rather than assigned: whatever was typed before the microphone
        // was tapped is still the user's, and dictation after it reads as a
        // continuation.
        draft = draft.isEmpty ? text : draft + " " + text
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
