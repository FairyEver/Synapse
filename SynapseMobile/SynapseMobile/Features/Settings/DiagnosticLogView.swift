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
            } footer: {
                Text("只记录崩溃、网络与终端交互的元数据，不记录你输入的命令和终端里的内容。")
            }

            Section {
                Button {
                    export()
                } label: {
                    Label("导出并分享", systemImage: "square.and.arrow.up")
                }
                .disabled(snapshot.fileCount == 0)
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
        // 导出要读好几个文件、拼成一整份，在主线程上做会让这一下卡住。日志本来就
        // 已经落在磁盘上了，多等这一会儿没有代价。
        Task {
            let url = await Task.detached { DiagnosticLog.export() }.value
            guard let url else { return }
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
