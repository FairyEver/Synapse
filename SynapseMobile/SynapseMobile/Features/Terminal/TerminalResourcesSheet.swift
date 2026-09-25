import SwiftUI

struct TerminalResourcesSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: TerminalStore
    @State private var opened: TerminalResource?
    /// 每条链接问到的答案。没问到的就是没有键 —— 那时什么都不标，不拿「不知道」当失效。
    @State private var reachability: [String: TerminalResourceReachability] = [:]

    var body: some View {
        NavigationStack {
            List(store.resources) { resource in
                Button {
                    opened = resource
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(resource.name).lineLimit(2)
                        Text(resource.url.absoluteString)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        if reachability[resource.url.absoluteString] == .missing {
                            Label("链接已失效", systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 3)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .navigationTitle("会话资源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .sheet(item: $opened) { resource in
            TerminalResourceBrowser(url: resource.url) { opened = nil }
        }
        .task(id: store.resources) { await checkReachability() }
    }

    /// 把列表上的链接问一遍，失效的标出来。
    ///
    /// 结果逐条落进 `reachability`，不等全部问完 —— 一条慢的链接不该把其余几条的标记一起
    /// 压住。已经问过的不会重复问：`TerminalResourceReachabilityChecker` 自己记着答案。
    @MainActor
    private func checkReachability() async {
        let pending = store.resources
            .map(\.url)
            .filter { reachability[$0.absoluteString] == nil && TerminalResourceReachabilityChecker.isCheckable($0) }
        guard !pending.isEmpty else { return }

        await withTaskGroup(of: (String, TerminalResourceReachability).self) { group in
            var next = 0
            while next < pending.count && next < TerminalResourceReachabilityChecker.maximumConcurrentChecks {
                let url = pending[next]
                next += 1
                group.addTask {
                    (url.absoluteString, await TerminalResourceReachabilityChecker.shared.check(url))
                }
            }
            while let (key, answer) = await group.next() {
                reachability[key] = answer
                guard next < pending.count else { continue }
                let url = pending[next]
                next += 1
                group.addTask {
                    (url.absoluteString, await TerminalResourceReachabilityChecker.shared.check(url))
                }
            }
        }
    }
}
