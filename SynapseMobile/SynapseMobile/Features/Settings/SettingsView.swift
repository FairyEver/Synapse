import SwiftUI

struct SettingsView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @State private var showingSignOut = false

    var body: some View {
        @Bindable var display = display

        List {
            Section("账号") {
                // 只读的值用次要色，与系统「设置」里那些信息行一致：它是给你认的，
                // 不是给你点的，更不该比它自己的标签还显眼。
                LabeledContent("邮箱") {
                    Text(model.email ?? "未登录")
                        .foregroundStyle(.secondary)
                }
            }

            // A density names a cell size, not a column count, so the same choice
            // reads the same on a phone of any size — the grid recomputes around it.
            //
            // It governs the phone-driven mode only, where the pane's width is the
            // wrap and the density decides how much fits across it. In the
            // desktop-grid mode the computer's columns decide the size, which is why
            // that mode's own menu offers no density at all.
            Section {
                Picker("显示密度", selection: $display.density) {
                    ForEach(TerminalDensity.allCases, id: \.self) { density in
                        Text(density.label).tag(density)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("终端")
            }

            // 点一行就换电脑，和「终端」那一屏的设备行是同一件事的两个入口：
            // 那边是收起来的菜单，这边本来就是一列，直接把行变成按钮。
            //
            // 名字一律走 `model.desktopName(_:)`。它有三个来源——那台电脑正在发的
            // summary、设备列表接口带回来的名字、上一回见过的名字——哪一台该用哪一个
            // 由那一个函数说了算，不在这两处各推一遍。别的电脑的名字以前确实拿不到
            // （`mobile.presence` 只带 id），现在由 `/api/mobile/desktops` 带回来。
            Section("已连接的电脑") {
                if model.onlineDesktops.isEmpty {
                    // 标题和说明都取自 `model.connectivity`，也就是终端页空态用的同
                    // 一个来源：同一件事在一处告诉用户怎么解决（「请在电脑上打开
                    // Synapse 并登录。」或「请检查这台手机的网络。」），在另一处只丢一
                    // 句「没有」，两个答案就对不上了。
                    //
                    // `.online` 落不到这里——在线就至少有一台电脑签着。真落到了就按
                    // 「没有电脑」说，总比报一句「已连接」强。
                    //
                    // 留在列表里而不是铺满整屏：这一屏还有账号、终端、诊断日志几段，
                    // 空掉的只是其中一段。
                    let state = model.connectivity == .online ? .noComputer : model.connectivity
                    ContentUnavailableView(
                        state.label,
                        systemImage: "desktopcomputer",
                        description: state.guidance.map { Text($0) }
                    )
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(model.onlineDesktops) { desktop in
                        Button {
                            guard desktop.clientInstanceId != model.selectedDesktopClientInstanceId else { return }
                            Haptics.select()
                            model.selectDesktop(desktop.clientInstanceId)
                        } label: {
                            HStack {
                                Circle()
                                    .fill(desktop.clientInstanceId == model.selectedDesktopClientInstanceId
                                          ? Theme.running
                                          : Color.secondary)
                                    .frame(width: 7, height: 7)
                                Text(model.desktopName(desktop.clientInstanceId))
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                if desktop.clientInstanceId == model.selectedDesktopClientInstanceId {
                                    Text("当前")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(desktop.clientInstanceId == model.selectedDesktopClientInstanceId)
                        .accessibilityIdentifier("settings-desktop-\(desktop.clientInstanceId)")
                    }
                }
            }

            // 默认开着：让朋友复现一次不容易，"忘了先打开开关"是最没必要的一种浪费。
            // 关掉只停记录，**不删已有日志** —— 两件事合成一个动作，用户会失去
            // 刚表达过的那个意思。
            //
            // 用 `NavigationLink { destination }` 而不是 `Route`：`Route` 只有
            // `.terminal` 一个 case，是给跨 tab 深链用的，改它要连带审 `handleRoute`
            // 与 `NotificationRouter`；设置子页既不可深链也不需要状态恢复。
            Section {
                Toggle("记录诊断日志", isOn: Binding(
                    get: { DiagnosticLog.isEnabled },
                    set: { DiagnosticLog.isEnabled = $0 }
                ))
                // 同一个根因：应用根的 tint 在深色下是白色，开关的圆点也是白的。
                // 见 `Theme.switchOn`。
                .tint(Theme.switchOn)
                NavigationLink {
                    DiagnosticLogView()
                } label: {
                    Text("诊断日志")
                }
            } header: {
                Text("诊断")
            } footer: {
                Text("记录崩溃、网络与终端交互的元数据；终端屏幕内容可以单独关掉。")
            }

            Section {
                Button("退出登录", role: .destructive) { showingSignOut = true }
            }
        }
        .listStyle(.insetGrouped)
        .noticeOverlay(model)
        .navigationTitle("我的")
        .alert("退出登录？", isPresented: $showingSignOut) {
            Button("取消", role: .cancel) {}
            Button("退出", role: .destructive) {
                // A dialog button gets no feedback of its own, and this one empties the
                // app and returns it to the sign-in screen.
                Haptics.warning()
                Task { await model.signOut() }
            }
        } message: {
            Text("本机保存的登录信息会被清除，终端控制将失效。")
        }
    }
}
