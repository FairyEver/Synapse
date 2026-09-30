import SwiftUI

struct TerminalResourcesSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: TerminalStore
    let onOpen: (URL) -> Void
    @State private var pending: TerminalResource?
    /// 每条链接问到的答案。没问到的就是没有键 —— 那时什么都不标，不拿「不知道」当失效。
    @State private var reachability: [String: TerminalResourceReachability] = [:]

    private var urlsToCheck: [URL] {
        var seen: Set<String> = []
        return store.resources.flatMap(\.candidateURLs)
            .filter { seen.insert($0.absoluteString).inserted }
    }

    private var shareResources: [TerminalResource] {
        store.resources.filter { TerminalResourceCollector.shareRootID($0.url) != nil }
    }

    private var otherResources: [TerminalResource] {
        store.resources.filter { TerminalResourceCollector.shareRootID($0.url) == nil }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let pending {
                    candidateList(pending)
                } else {
                    resourceList
                }
            }
            .navigationTitle(pending == nil ? "会话资源" : "选择链接")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if pending != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("返回") { pending = nil }
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭") { dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task(id: urlsToCheck) { await checkReachability() }
        .onDisappear {
            pending = nil
            reachability.removeAll()
        }
    }

    private var resourceList: some View {
        List {
            ForEach(shareResources) { resource in
                resourceRow(resource)
            }
            if shareResources.isEmpty {
                ForEach(otherResources) { resource in
                    resourceRow(resource)
                }
            } else if !otherResources.isEmpty {
                Section("其他链接") {
                    ForEach(otherResources) { resource in
                        resourceRow(resource)
                    }
                }
            }
        }
    }

    private func resourceRow(_ resource: TerminalResource) -> some View {
        Button {
            if resource.candidateURLs.count > 1 {
                pending = resource
            } else {
                onOpen(resource.url)
            }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(resource.name).lineLimit(1)
                Text(resource.url.absoluteString)
                    .font(.subheadline.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                if resource.candidateURLs.count > 1 {
                    Text("选择链接")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if let status = statusText(for: resource.url) {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if resource.needsConfirmation {
                    Text("待确认")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func candidateList(_ resource: TerminalResource) -> some View {
        List(resource.candidateURLs, id: \.absoluteString) { url in
            Button {
                onOpen(url)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(url.absoluteString)
                        .font(.subheadline.monospaced())
                    if let status = statusText(for: url) {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// Keep a status line in place while the request finishes so rows do not move
    /// under a finger. A failed check says only that the result is unknown.
    private func statusText(for url: URL) -> String? {
        guard TerminalResourceReachabilityChecker.isCheckable(url) else { return nil }
        switch reachability[url.absoluteString] {
        case .reachable: return "可访问"
        case .missing: return "链接已失效"
        case .unknown: return "无法确认"
        case nil: return "正在检查"
        }
    }

    /// 把列表上的链接问一遍，失效的标出来。
    ///
    /// 结果逐条落进 `reachability`，不等全部问完 —— 一条慢的链接不该把其余几条的标记一起
    /// 压住。面板关闭时清掉这批答案，下次打开重新核验。
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
                guard !Task.isCancelled else { break }
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
