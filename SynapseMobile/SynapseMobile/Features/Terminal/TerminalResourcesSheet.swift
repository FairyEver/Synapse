import SwiftUI

struct TerminalResourcesSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: TerminalStore
    @State private var path: [TerminalResource] = []
    @State private var detent: PresentationDetent = .medium

    var body: some View {
        NavigationStack(path: $path) {
            List(store.resources) { resource in
                NavigationLink(value: resource) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(resource.name).lineLimit(2)
                        Text(kindName(resource.kind))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(resource.url.absoluteString)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .padding(.vertical, 3)
                }
            }
            .navigationTitle("会话资源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .navigationDestination(for: TerminalResource.self) { resource in
                TerminalResourceDetail(resource: resource) { kind in
                    store.setResourceKind(kind, for: resource.url)
                }
            }
        }
        .presentationDetents(path.isEmpty ? [.medium, .large] : [.large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onChange(of: path) { _, newPath in detent = newPath.isEmpty ? .medium : .large }
    }
}

private struct TerminalResourceDetail: View {
    let resource: TerminalResource
    let onKind: (TerminalResource.Kind) -> Void
    @State private var browserState = TerminalResourceBrowserState()

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal) {
                Text(resource.url.absoluteString)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .padding()
            }

            ZStack {
                TerminalResourceBrowser(url: resource.url, state: browserState, onKind: onKind)
                    .opacity(browserState.presentation == .web ? 1 : 0)

                switch browserState.presentation {
                case .loading:
                    ProgressView("正在打开")
                case .downloading:
                    ProgressView("正在下载")
                case .web:
                    EmptyView()
                case .downloaded(let url, let kind):
                    VStack(spacing: 12) {
                        TerminalDownloadedPreview(url: url)
                        if kind == .file {
                            ShareLink("保存文件", item: url)
                                .padding(.bottom)
                        }
                    }
                case .failed(let message):
                    ContentUnavailableView(message, systemImage: "exclamationmark.triangle")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: resource.url) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("分享链接")
            }
        }
    }

    private var title: String {
        switch browserState.presentation {
        case .downloaded(_, .image): "图片预览"
        case .downloaded: "文件"
        default:
            switch browserState.displayedKind {
            case .image: "图片"
            case .file: "文件"
            default: "网页"
            }
        }
    }
}

private func kindName(_ kind: TerminalResource.Kind) -> String {
    switch kind {
    case .link: "链接"
    case .webpage: "网页"
    case .image: "图片"
    case .file: "文件"
    }
}
