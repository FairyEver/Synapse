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

            Section("已连接的电脑") {
                if model.onlineDesktops.isEmpty {
                    Text("没有在线的电脑")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.onlineDesktops, id: \.self) { desktop in
                        HStack {
                            Circle()
                                .fill(Theme.running)
                                .frame(width: 7, height: 7)
                            // 正在看的这台显示它的名字，与「终端」那一屏的设备行同一套
                            // 写法。名字只有一个来源：这台电脑自己发来的 summary ——
                            // `mobile.presence` 只带 id，所以**别的**电脑叫什么，手机
                            // 无从得知，只能显示 id。这不是这一处能修的，要改协议。
                            Text(desktop == model.selectedDesktopClientInstanceId
                                 ? (model.summary?.desktopName ?? desktop)
                                 : desktop)
                                .font(.subheadline)
                                .lineLimit(1)
                            Spacer()
                            if desktop == model.selectedDesktopClientInstanceId {
                                Text("当前")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
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
                NavigationLink {
                    DiagnosticLogView()
                } label: {
                    Text("诊断日志")
                }
            } header: {
                Text("诊断")
            } footer: {
                Text("只记录崩溃、网络与终端交互的元数据，不记录你输入的命令和终端里的内容。")
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
