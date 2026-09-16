import SwiftUI

struct SettingsView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @State private var showingSignOut = false

    var body: some View {
        @Bindable var display = display

        List {
            Section("账号") {
                LabeledContent("邮箱", value: model.email ?? "未登录")
            }

            // A density names a cell size, not a column count, so the same choice
            // reads the same on a phone of any size — the grid recomputes around it.
            //
            // It is the reading preference for the mode where the phone decides the
            // wrap, and the footer says so. In the desktop-grid mode the computer's
            // column count decides the size, so a reader who changes this and opens
            // such a terminal would otherwise find that nothing happened and conclude
            // the setting is broken.
            Section {
                Picker("显示密度", selection: $display.density) {
                    ForEach(TerminalDensity.allCases, id: \.self) { density in
                        Text(density.label).tag(density)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("终端")
            } footer: {
                Text("\(display.density.detail)。只在「优先移动端」生效：那里一行放多少字由你定。「优先还原」按电脑的列数排版，字的大小随它算。")
            }

            Section("已连接的电脑") {
                if model.onlineDesktops.isEmpty {
                    Text("没有在线的电脑")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.onlineDesktops, id: \.self) { desktop in
                        HStack {
                            Circle()
                                .fill(Theme.running)
                                .frame(width: 7, height: 7)
                            Text(desktop)
                                .font(.system(size: 14))
                                .lineLimit(1)
                            Spacer()
                            if desktop == model.selectedDesktopClientInstanceId {
                                Text("当前")
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            Section {
                Button("退出登录", role: .destructive) { showingSignOut = true }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("我的")
        .alert("退出登录？", isPresented: $showingSignOut) {
            Button("取消", role: .cancel) {}
            Button("退出", role: .destructive) {
                Task { await model.signOut() }
            }
        } message: {
            Text("本机保存的登录信息会被清除，终端控制将失效。")
        }
    }
}
