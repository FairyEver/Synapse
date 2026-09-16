import SwiftUI

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
        // The status bar text colour is decided by the scene, not by this
        // subtree, so it needs its own declaration to turn white.
        .preferredColorScheme(.dark)
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
            Text("终端会收到挂起信号并退出，未保存的进程状态会丢失。")
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
