import SwiftUI

struct SettingsView: View {
    @Environment(SynapseAppModel.self) private var model
    @State private var showingSignOut = false

    var body: some View {
        List {
            Section("账号") {
                LabeledContent("邮箱", value: model.email ?? "未登录")
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
