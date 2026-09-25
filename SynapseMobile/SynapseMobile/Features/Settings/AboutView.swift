import SwiftUI

/// 关于这一台手机上的 Synapse。
///
/// 版本号在这里，**但终端页顶栏第二行那份不搬走**：那个位置是「我正在用的这个终端」旁边，
/// 出问题时人就在那里，抬头就能念出来。两处是同一件事的两个入口，不是重复 —— 一处是
/// 「我在哪一屏」，一处是「我要报个问题」。
struct AboutView: View {
    var body: some View {
        List {
            Section {
                LabeledContent("版本") {
                    Text(AppVersion.label)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                NavigationLink {
                    ProblemFeedbackView()
                } label: {
                    Text("问题反馈")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("关于")
        .navigationBarTitleDisplayMode(.inline)
    }
}
