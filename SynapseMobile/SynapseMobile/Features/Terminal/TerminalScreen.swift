import SwiftUI
import UIKit

/// One terminal, full screen.
struct TerminalScreen: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let sessionId: String
    @State private var draft = ""
    @State private var fontSize: CGFloat = 12
    @State private var showingRename = false
    @State private var renamingTitle = ""
    @State private var showingStopConfirm = false
    @FocusState private var inputFocused: Bool

    private var store: TerminalStore { model.store(for: sessionId) }
    private var session: MobileSummarySession? { model.session(sessionId) }

    var body: some View {
        @Bindable var model = model

        VStack(spacing: 0) {
            navigationBar
            TerminalTextView(
                store: store,
                fontSize: fontSize,
                revision: store.lastSeq,
                onRequestHistory: { model.requestHistory(sessionId) },
                onTap: { inputFocused = false }
            )
            .background(Theme.terminalBackground)
            accessoryBar
            inputBar
        }
        .background(Theme.terminalBackground.ignoresSafeArea(edges: .bottom))
        // The terminal canvas is a dark surface by nature — its colours come from
        // the desktop's emulator, not from the app's theme. Leaving the chrome to
        // follow the system puts a dark screen inside a light frame, which reads as
        // a picture pasted onto paper. Pinning the colour scheme for this subtree
        // keeps the whole screen one surface in either system appearance; the list
        // and settings screens still follow the system.
        .environment(\.colorScheme, .dark)
        .modifier(DarkWindowWhileVisible())
        .navigationBarBackButtonHidden(true)
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
                // Hand the window back to the system *before* popping. The list is
                // laid out as part of the pop, and if the window is still dark when
                // that happens the list renders dark for its first frames and then
                // switches — which is the flash. Waiting for `onDisappear` is too
                // late: by then the incoming screen has already drawn.
                DarkWindowWhileVisible.restore()
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
                    .background(.ultraThinMaterial, in: Circle())
            }
            .tint(.primary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                // Extend through the status bar: the window background would
                // otherwise show as a light band above a dark navigation bar.
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
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
        }
        .background(.ultraThinMaterial)
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
        .background(.ultraThinMaterial)
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

/// Holds the window in the dark appearance for as long as this screen is up.
///
/// The terminal is a dark surface, and two things about it are decided by the
/// scene rather than by this subtree: the status bar's text colour, and the
/// material behind the navigation bar. `.environment(\.colorScheme, .dark)` only
/// reaches the subtree, so on its own it leaves black status bar text and a light
/// band across the top.
///
/// `preferredColorScheme(.dark)` does reach both, but it is a *scene* preference
/// and it costs the screen that comes next: the incoming view is laid out while
/// the terminal is still on screen, so whatever the scene's appearance is at that
/// moment is what the new screen draws its first frames in. Leaving through
/// `onDisappear` is too late for the same reason — measured on the simulator, the
/// list still came up dark for about 150 ms and then switched.
///
/// So the window is handed back explicitly before the pop (see the back button),
/// with `onDisappear` left as a safety net for any other way off this screen.
private struct DarkWindowWhileVisible: ViewModifier {
    func body(content: Content) -> some View {
        content
            .onAppear { Self.apply(.dark) }
            .onDisappear { Self.restore() }
    }

    static func restore() {
        apply(.unspecified)
    }

    private static func apply(_ style: UIUserInterfaceStyle) {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
        guard let window, window.overrideUserInterfaceStyle != style else { return }
        UIView.performWithoutAnimation {
            window.overrideUserInterfaceStyle = style
        }
    }
}
