import SwiftUI

/// A feature's list and selected item share one navigation model at every window size.
/// NavigationSplitView keeps the list beside the detail when there is room and folds
/// them into a stack when the window becomes compact.
struct AdaptiveFeatureNavigation<Selection: Hashable, Sidebar: View, Detail: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Binding var selection: Selection?
    let emptyTitle: String
    let emptySymbol: String
    @ViewBuilder let sidebar: () -> Sidebar
    @ViewBuilder let detail: (Selection) -> Detail

    @State private var columnVisibility: NavigationSplitViewVisibility = .doubleColumn
    @State private var preferredCompactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        NavigationSplitView(
            columnVisibility: $columnVisibility,
            preferredCompactColumn: $preferredCompactColumn
        ) {
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
        .navigationSplitViewStyle(.balanced)
        .onAppear {
            preferredCompactColumn = selection == nil ? .sidebar : .detail
        }
        .onChange(of: selection) { _, current in
            preferredCompactColumn = current == nil ? .sidebar : .detail
        }
        .onChange(of: preferredCompactColumn) { previous, current in
            if horizontalSizeClass == .compact, previous == .detail, current == .sidebar {
                selection = nil
            }
        }
    }
}
