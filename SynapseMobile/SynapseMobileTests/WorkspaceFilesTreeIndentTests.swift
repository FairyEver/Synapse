import Testing
import UIKit
@testable import SynapseMobile

/// The file tree's visual staircase: every level sits exactly one uniform
/// step right of its parent, so expanding a folder never leaves its children
/// at the parent's own column. The step is the system outline rhythm
/// measured on iOS 18.6 (children-based `List`, plain and sidebar: 20pt).
/// File and directory rows share one icon column per depth, and a narrow
/// column shrinks the step instead of collapsing levels prematurely.
///
/// Regression: the previous implementation ran the level offset through
/// `UITableViewCell.indentationLevel`, whose cell layout margins mixed with
/// the list content's default leading and produced 0 / 13 / 16pt steps.
@MainActor
struct WorkspaceFilesTreeIndentTests {
    private final class Source: NSObject, UITableViewDataSource {
        private let fileDepths: Set<Int>
        private let count: Int

        init(count: Int, fileDepths: Set<Int>) {
            self.count = count
            self.fileDepths = fileDepths
        }

        func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { count }

        func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
            let cell = tableView.dequeueReusableCell(
                withIdentifier: WorkspaceFilesNativeEntryCell.reuseIdentifier, for: indexPath)
            guard let native = cell as? WorkspaceFilesNativeEntryCell else { return cell }
            let isFile = fileDepths.contains(indexPath.row)
            let entry = WorkspaceFilesNativeEntry(
                title: "row\(indexPath.row)",
                parentPath: nil,
                systemImage: isFile ? "doc.text" : "folder",
                depth: indexPath.row,
                accessibilityIdentifier: "indent-\(indexPath.row)",
                accessibilityLabel: "row\(indexPath.row)",
                isDirectory: !isFile,
                isExpanded: false)
            native.configure(entry, menu: nil, isEnabled: true) { false }
            return native
        }
    }

    /// The icon column's center for rows at depth 0, 1, 2 … in a column of
    /// the given width, measured from the cell's leading edge. Symbols with
    /// different widths are centered on one column, so the center — not the
    /// ink's leading edge — is what must match across file and folder rows.
    private func iconColumns(width: CGFloat, count: Int, fileDepths: Set<Int> = []) -> [CGFloat] {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 1000))
        let host = UIViewController()
        window.rootViewController = host
        window.isHidden = false
        let source = Source(count: count, fileDepths: fileDepths)
        let table = UITableView(frame: CGRect(x: 0, y: 100, width: width, height: 800), style: .plain)
        table.dataSource = source
        table.rowHeight = 60
        table.register(WorkspaceFilesNativeEntryCell.self,
            forCellReuseIdentifier: WorkspaceFilesNativeEntryCell.reuseIdentifier)
        host.view.addSubview(table)
        host.view.layoutIfNeeded()
        table.layoutIfNeeded()
        objc_setAssociatedObject(table, "indent-source", source, .OBJC_ASSOCIATION_RETAIN)
        return table.visibleCells
            .sorted { $0.frame.minY < $1.frame.minY }
            .compactMap { cell in
                guard let native = cell as? WorkspaceFilesNativeEntryCell,
                      let list = native.contentView as? UIListContentView,
                      let guide = list.imageLayoutGuide else { return nil }
                return guide.layoutFrame.midX
            }
    }

    @Test func everyLevelSitsOneFullStepRightOfItsParent() {
        let columns = iconColumns(width: 370, count: 6)
        #expect(columns.count == 6)
        let steps = zip(columns.dropFirst(), columns).map { $0 - $1 }
        for step in steps {
            #expect(abs(step - WorkspaceFilesTreeMetrics.indentStep) < 0.1,
                "each level must advance by one full step, saw \(steps)")
        }
    }

    @Test func fileRowsShareTheDirectoryIconColumn() {
        let directories = iconColumns(width: 370, count: 4)
        let files = iconColumns(width: 370, count: 4, fileDepths: [0, 1, 2, 3])
        #expect(directories.count == files.count)
        for (directory, file) in zip(directories, files) {
            #expect(abs(directory - file) < 0.1,
                "files and folders at one depth must share the icon column, saw \(directories) vs \(files)")
        }
    }

    @Test func narrowColumnsShrinkTheStepWithoutMovingLevelsBackwards() {
        let columns = iconColumns(width: 250, count: 7)
        let steps = zip(columns.dropFirst(), columns).map { $0 - $1 }
        // Above the readable-width budget the step is still the full one.
        for step in steps.prefix(4) {
            #expect(abs(step - WorkspaceFilesTreeMetrics.indentStep) < 0.1,
                "shallow levels keep the full step, saw \(steps)")
        }
        // The budget only caps the total indent; deeper levels never move
        // backwards onto (or left of) an earlier level's column.
        for step in steps {
            #expect(step >= 0, "level columns must not move backwards, saw \(columns)")
        }
    }
}
