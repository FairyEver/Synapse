import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct WorkspaceFilesNativeRowsTests {
    @Test func aPagedDirectoryContinuesAfterItsHundredLoadedChildren() {
        let files = (0..<100).map { row(String(format: "nested/paging/page-%04d.txt", $0), depth: 2) }
        let tree = [row("nested", depth: 0, directory: true), row("nested/paging", depth: 1, directory: true)]
            + files + [row("nested/notes.txt", depth: 1), row("root.txt", depth: 0)]
        let rows = WorkspaceFilesNativeBrowserRow.treeRows(tree, expanded: ["nested", "nested/paging"]) {
            $0 == "nested/paging"
        }
        let continuation = rows.firstIndex { $0.kind == .directoryContinuation }
        #expect(continuation == 102)
        #expect(rows[101].entry?.relativePath == "nested/paging/page-0099.txt")
        #expect(rows[102].entry?.relativePath == "nested/paging")
        #expect(rows[102].depth == 2)
        #expect(rows[103].entry?.relativePath == "nested/notes.txt")
        #expect(rows[104].entry?.relativePath == "root.txt")
    }

    @Test func nestedContinuationsCloseFromTheDeepestDirectoryAtTheEnd() {
        let tree = [row("a", depth: 0, directory: true), row("a/b", depth: 1, directory: true),
            row("a/b/c", depth: 2, directory: true), row("a/b/c/file.txt", depth: 3)]
        let rows = WorkspaceFilesNativeBrowserRow.treeRows(tree, expanded: ["a", "a/b", "a/b/c"]) { _ in true }
        #expect(rows.map(\.id) == ["a", "a/b", "a/b/c", "a/b/c/file.txt",
            "files-directory-continuation-a/b/c", "files-directory-continuation-a/b", "files-directory-continuation-a"])
        #expect(rows.suffix(3).map(\.depth) == [3, 2, 1])
    }

    @Test func emptyExpandedDirectoriesContinueBeforeSiblingsAndCollapsedOnesDoNot() {
        let tree = [row("empty", depth: 0, directory: true), row("closed", depth: 0, directory: true),
            row("root.txt", depth: 0)]
        let rows = WorkspaceFilesNativeBrowserRow.treeRows(tree, expanded: ["empty"]) { _ in true }
        #expect(rows.map(\.id) == ["empty", "files-directory-continuation-empty", "closed", "root.txt"])
        #expect(rows[0].isExpanded)
        #expect(!rows[2].isExpanded)
    }

    private func row(_ path: String, depth: Int, directory: Bool = false) -> WorkspaceFileTreeRow {
        WorkspaceFileTreeRow(entry: WorkspaceFileEntry(entryId: path, relativePath: path,
            kind: directory ? "directory" : "file"), depth: depth)
    }
}
