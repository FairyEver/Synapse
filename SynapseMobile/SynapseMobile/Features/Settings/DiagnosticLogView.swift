import SwiftUI
import UIKit

/// 诊断日志的详情页：看状态、导出、删除。
///
/// 这一页存在，是因为这套机制的价值全在"用户能把文件发出来"这一步上。日志本身
/// 写得再全，没有这个按钮也只是一堆谁也拿不到的文件。
struct DiagnosticLogView: View {
    @State private var snapshot = DiagnosticLog.snapshot()
    @State private var exportURL: URL?
    @State private var showingDeleteConfirm = false
    @State private var showingContentExportConfirm = false
    @State private var capturesContent = DiagnosticLog.capturesContent

    var body: some View {
        List {
            Section {
                LabeledContent("状态") {
                    Text(snapshot.status.rawValue)
                        .foregroundStyle(snapshot.status == .running ? .secondary : .primary)
                }
                LabeledContent("占用") {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(snapshot.totalBytes), countStyle: .file))
                        .foregroundStyle(.secondary)
                }
                LabeledContent("文件数") {
                    Text("\(snapshot.fileCount)")
                        .foregroundStyle(.secondary)
                }
                if let oldest = snapshot.oldest, let newest = snapshot.newest {
                    LabeledContent("时间范围") {
                        Text("\(Self.short(oldest)) — \(Self.short(newest))")
                            .foregroundStyle(.secondary)
                    }
                }
                if snapshot.dropped > 0 || snapshot.overwritten > 0 {
                    LabeledContent("已丢弃") {
                        Text("\(snapshot.dropped) 条限流，\(snapshot.overwritten) 条覆盖")
                            .foregroundStyle(.secondary)
                    }
                }
                // 各域占用。只列有内容的 —— 一个字节都没写的域不占一行，而"某一路
                // 永远是空的"恰恰是这套机制最安静的失效方式（不报错、不崩，只是那条
                // 线索永远不在）。要分辨"没发生"与"没接上"，这一行就是全部依据。
                let used = DiagnosticLane.allCases.filter { snapshot.bytes(in: $0) > 0 }
                if !used.isEmpty {
                    LabeledContent("各域占用") {
                        Text(used.map { lane in
                            "\(lane.rawValue) "
                                + ByteCountFormatter.string(
                                    fromByteCount: Int64(snapshot.bytes(in: lane)),
                                    countStyle: .file
                                )
                        }.joined(separator: " · "))
                        .foregroundStyle(.secondary)
                    }
                }
            } footer: {
                Text("记录崩溃、网络与终端交互的元数据，以及每一路各占多少。")
            }

            Section {
                Toggle("记录终端屏幕内容", isOn: $capturesContent)
                    // 同一个根因：应用根的 tint 在深色下是白色，开关的圆点也是白的，
                    // 一颗开着的开关就成了一块没有圆点的白方块。见 `Theme.switchOn`。
                    .tint(Theme.switchOn)
                    .onChange(of: capturesContent) { _, value in
                        DiagnosticLog.capturesContent = value
                    }
            } footer: {
                Text("打开后会记下屏幕上的内容与你发给电脑的命令（每秒至多一条，先经脱敏）。"
                    + "导出时的压缩包里会一并包含，并写明本次是否包含。")
            }

            Section {
                Button {
                    // 包含内容时先问一句。这份包是从微信发出去的，而"用户交出去的东西
                    // 必须是他当场就知道的"是这件事唯一站得住的理由 —— 开关开着久了，
                    // 按导出的人未必还记得自己当初打开过它。
                    if capturesContent {
                        showingContentExportConfirm = true
                    } else {
                        export()
                    }
                } label: {
                    Label("导出并分享", systemImage: "square.and.arrow.up")
                }
                .disabled(snapshot.fileCount == 0)
            } footer: {
                Text(capturesContent ? "本次导出包含终端屏幕内容。" : "本次导出不含终端屏幕内容。")
            }

            Section {
                Button("删除全部日志", role: .destructive) {
                    showingDeleteConfirm = true
                }
                .disabled(snapshot.fileCount == 0)
            }
        }
        .navigationTitle("诊断日志")
        .navigationBarTitleDisplayMode(.inline)
        .task { refresh() }
        .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) {
            if let exportURL {
                ActivityView(url: exportURL) { self.exportURL = nil }
            }
        }
        .alert("这份压缩包里包含终端屏幕内容", isPresented: $showingContentExportConfirm) {
            Button("取消", role: .cancel) {}
            Button("继续导出") { export() }
        } message: {
            Text("里面会有最近记下的终端屏幕内容与你发给电脑的命令。确认要分享时请注意发给谁。")
        }
        .alert("删除全部日志？", isPresented: $showingDeleteConfirm) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                DiagnosticLog.deleteAll()
                refresh()
            }
        } message: {
            Text("已经导出的文件不受影响。删除后仍会继续记录新的。")
        }
    }

    private func refresh() {
        snapshot = DiagnosticLog.snapshot()
    }

    private func export() {
        // 导出要读好几个文件、拼成一整份、再压成一个包。这些全排在日志自己那条
        // 后台队列上，这里只等结果 —— 从前那层 `Task.detached` 是无效的（它会先跳回
        // 主线程再同步阻塞）。
        Task {
            guard let url = await DiagnosticLog.export() else { return }
            exportURL = url
        }
    }

    private static func short(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: date)
    }
}

/// 系统分享面板。
///
/// 用 `UIViewControllerRepresentable` 而不是去 responder chain 上找那个最顶层的
/// 控制器：在 SwiftUI 里后者随时可能因为弹出层级变化而找错人，而这个是系统自己
/// 给的挂法。
private struct ActivityView: UIViewControllerRepresentable {
    let url: URL
    let onFinish: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in onFinish() }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
