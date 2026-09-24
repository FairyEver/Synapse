import SwiftUI

/// A feature's list and selected item share one navigation model at every window size.
/// NavigationSplitView keeps the list beside the detail when there is room and folds
/// them into a stack when the window becomes compact.
struct AdaptiveFeatureNavigation<Selection: Hashable, Sidebar: View, Detail: View>: View {
    @Binding var selection: Selection?
    let emptyTitle: String
    let emptySymbol: String
    @ViewBuilder let sidebar: () -> Sidebar
    @ViewBuilder let detail: (Selection) -> Detail

    @State private var preferredCompactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $preferredCompactColumn) {
            sidebar()
                .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 420)
        } detail: {
            if let selection {
                detail(selection)
                    .id(selection)
            } else {
                ContentUnavailableView(emptyTitle, systemImage: emptySymbol)
            }
        }
        .onAppear {
            preferredCompactColumn = selection == nil ? .sidebar : .detail
        }
        .onChange(of: selection) { _, current in
            preferredCompactColumn = current == nil ? .sidebar : .detail
        }
    }
}
