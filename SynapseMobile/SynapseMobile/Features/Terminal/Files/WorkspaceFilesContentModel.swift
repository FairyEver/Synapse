import Foundation

nonisolated struct WorkspaceFilesDisplayRow: Identifiable, Sendable {
    let id: String
    let isHeader: Bool
    let kind: String
    let oldNumber: Int?
    let newNumber: Int?
    let text: String
    let truncated: Bool
}

nonisolated enum WorkspaceFilesContentModel {
    static func rows(from pages: [WorkspaceFilesData]) -> [WorkspaceFilesDisplayRow] {
        var rows: [WorkspaceFilesDisplayRow] = []
        for (pageIndex, page) in pages.enumerated() {
            if let lines = page.lines {
                for (offset, line) in lines.enumerated() {
                    rows.append(WorkspaceFilesDisplayRow(id: "p\(pageIndex):l\(offset)", isHeader: false,
                        kind: "context", oldNumber: nil, newNumber: line.lineNumber,
                        text: line.text, truncated: line.truncated))
                }
            }
            for hunk in page.hunks ?? [] {
                let offset = hunk.lineOffset ?? 0
                let id = "p\(pageIndex):\(hunk.hunkId):\(offset)"
                let text = "@@ −\(hunk.oldStart ?? 0),\(hunk.oldCount ?? 0) +\(hunk.newStart ?? 0),\(hunk.newCount ?? 0) @@" + (hunk.continued == true ? "（续）" : "")
                rows.append(WorkspaceFilesDisplayRow(id: id + ":header", isHeader: true, kind: "meta",
                    oldNumber: hunk.oldStart, newNumber: hunk.newStart, text: text, truncated: false))
                for (lineOffset, line) in hunk.lines.enumerated() {
                    rows.append(WorkspaceFilesDisplayRow(id: id + ":l\(lineOffset + offset)", isHeader: false,
                        kind: line.kind, oldNumber: line.oldLineNumber, newNumber: line.newLineNumber,
                        text: line.text, truncated: line.truncated == true))
                }
            }
        }
        return rows
    }
}
