import SwiftUI
import UIKit

/// One terminal, full screen.
struct TerminalScreen: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Environment(\.dismiss) private var dismiss

    let sessionId: String
    @State private var draft = ""
    /// Follows the density in force for this session rather than being held as view
    /// state: it is a setting, and a copy here is how the two drift apart.
    private var fontSize: CGFloat { display.density(for: sessionId).fontSize }
    @State private var showingRename = false
    @State private var renamingTitle = ""
    @State private var showingStopConfirm = false
    @FocusState private var inputFocused: Bool

    private var store: TerminalStore { model.store(for: sessionId) }
    private var session: MobileSummarySession? { model.session(sessionId) }

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
            // The desktop's own layout decides again from here. The phone has no way
            // to name the size the desktop would have chosen — all it ever heard is
            // the size the PTY currently has, which is the phone's.
            model.releaseGrid(for: sessionId)
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
            .onChange(of: inputFocused) { reportGridToDesktop() }
            accessoryBar
            inputBar
        }
        .background(Theme.terminalBackground.ignoresSafeArea(edges: .bottom))
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
        .onAppear { model.openTerminal(sessionId) }
        .onDisappear { model.closeTerminal(sessionId) }
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
    }

    // MARK: - Bars

    private var navigationBar: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
            }

            VStack(spacing: 1) {
                Text(session?.title ?? "终端")
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)
                    Text(statusLabel)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
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
                Picker(selection: sessionDensityBinding) {
                    Text("跟随系统").tag(TerminalDensity?.none)
                    ForEach(TerminalDensity.allCases, id: \.self) { value in
                        Text(value.label).tag(TerminalDensity?.some(value))
                    }
                } label: {
                    Label("本会话显示密度", systemImage: "textformat.size")
                }
                Button {
                    renamingTitle = session?.title ?? ""
                    showingRename = true
                } label: {
                    Label("重命名", systemImage: "pencil")
                }
                Button {
                    UIPasteboard.general.string = store.plainText
                    model.banner = "已复制终端输出。"
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
            }
            .tint(.primary)
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

    /// Exactly the keys the desktop can encode. Nothing here is aspirational:
    /// the terminal service rejects arbitrary control bytes, so a Ctrl modifier
    /// or a free-form key could not be delivered even if it were drawn.
    private var accessoryBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(MobileKey.allCases, id: \.self) { key in
                    Button(key.label) {
                        model.sendKey(sessionId, key)
                        inputFocused = true
                    }
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(minWidth: 40)
                    .padding(.vertical, 7)
                    .padding(.horizontal, 8)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
        }
        .background(Color(uiColor: .systemBackground))
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("输入命令", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.send)
                .focused($inputFocused)
                .onSubmit(sendDraft)

            Button(action: sendDraft) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(draft.isEmpty ? Color.secondary : Theme.ink)
            }
            .disabled(draft.isEmpty)
            .accessibilityIdentifier("send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
    }

    private func sendDraft() {
        let text = draft
        guard !text.isEmpty else { return }
        draft = ""
        model.sendCommand(sessionId, text: text)
    }

    private var statusLabel: String {
        guard let session else { return model.summaryConnectivityLabel() }
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
