import SwiftUI

struct TerminalResourcesSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: TerminalStore
    /// 要在浏览器里打开的那一条。装的是共用的那个打开链接的能力（`LinkBrowser`），
    /// 与云盘点开一个文件走的是同一条。
    @State private var opened: WebLink?
    @State private var pending: TerminalResource?
    /// 每条链接问到的答案。没问到的就是没有键 —— 那时什么都不标，不拿「不知道」当失效。
    @State private var reachability: [String: TerminalResourceReachability] = [:]

    private var urlsToCheck: [URL] {
        store.resources.filter { !$0.needsConfirmation }.map(\.url) + (pending?.candidateURLs ?? [])
    }

    var body: some View {
        NavigationStack {
            List(store.resources) { resource in
                Button {
                    if resource.needsConfirmation {
                        pending = resource
                    } else {
                        opened = WebLink(url: resource.url)
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        if resource.needsConfirmation {
                            Text(resource.name).lineLimit(2)
                            Text(resource.url.absoluteString)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text("链接边界待确认")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
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
                    }
                    .padding(.vertical, 3)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .navigationDestination(item: $pending) { resource in
                candidateList(resource)
            }
            .navigationTitle("会话资源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .linkBrowser($opened)
        .task(id: urlsToCheck) { await checkReachability() }
    }

    private func candidateList(_ resource: TerminalResource) -> some View {
        List(resource.candidateURLs, id: \.absoluteString) { url in
            Button {
                opened = WebLink(url: url)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(url.absoluteString)
                        .font(.subheadline.monospaced())
                    if reachability[url.absoluteString] == .reachable {
                        Text("可访问")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if reachability[url.absoluteString] == .missing {
                        Text("链接已失效")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .navigationTitle("选择链接")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// 把列表上的链接问一遍，失效的标出来。
    ///
    /// 结果逐条落进 `reachability`，不等全部问完 —— 一条慢的链接不该把其余几条的标记一起
    /// 压住。已经问过的不会重复问：`TerminalResourceReachabilityChecker` 自己记着答案。
    @MainActor
    private func checkReachability() async {
        let pending = urlsToCheck
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
