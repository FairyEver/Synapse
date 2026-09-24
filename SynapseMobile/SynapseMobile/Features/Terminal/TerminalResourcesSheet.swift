import SwiftUI

struct TerminalResourcesSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: TerminalStore
    @State private var opened: TerminalResource?

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
        .fullScreenCover(item: $opened) { resource in
            TerminalResourceBrowser(url: resource.url) { opened = nil }
                .ignoresSafeArea()
        }
    }
}
