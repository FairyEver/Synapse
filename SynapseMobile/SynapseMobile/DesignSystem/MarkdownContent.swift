import Foundation
import SwiftUI

/// A shared, read-only Markdown document. Foundation supplies the syntax tree;
/// SwiftUI's Text renders inline intents, while this model retains block intents.
nonisolated struct MarkdownDocument: Sendable {
    private static let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    nonisolated struct Block: Sendable {
        nonisolated enum Kind: Equatable, Sendable {
            case paragraph
            case heading(Int)
            case listItem(marker: String, depth: Int)
            case quote
            case code
            case plain
        }

        let id: Int
        let kind: Kind
        var content: AttributedString

        var text: String { String(content.characters) }
    }

    let blocks: [Block]

    init(_ source: String) {
        do {
            let parsed = try AttributedString(
                markdown: source,
                options: .init(interpretedSyntax: .full)
            )
            // This reader intentionally has no image loader or table layout. Keep
            // the source visible instead of dropping cells or image destinations.
            if parsed.runs.contains(where: { run in
                run.imageURL != nil || run.presentationIntent?.components.contains(where: { component in
                    if case .table = component.kind { return true }
                    return false
                }) == true
            }) {
                blocks = [Block(id: 0, kind: .plain, content: AttributedString(source))]
                return
            }

            var result: [Block] = []
            for run in parsed.runs {
                guard let intent = run.presentationIntent,
                      let leaf = intent.components.first else { continue }
                let content = AttributedString(parsed[run.range])
                if result.last?.id == leaf.identity {
                    result[result.count - 1].content += content
                } else {
                    result.append(Block(
                        id: leaf.identity,
                        kind: Self.kind(for: intent.components),
                        content: content
                    ))
                }
            }
            if result.isEmpty && !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                blocks = [Block(id: 0, kind: .plain, content: AttributedString(source))]
                return
            }
            blocks = result.map { block in
                var linked = block
                if block.kind != .code { linked.content = Self.linkBareURLs(in: block.content) }
                return linked
            }
        } catch {
            blocks = [Block(id: 0, kind: .plain, content: AttributedString(source))]
        }
    }

    var previewText: String {
        blocks.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private static func kind(for components: [PresentationIntent.IntentType]) -> Block.Kind {
        if let heading = components.first(where: { if case .header = $0.kind { true } else { false } }),
           case .header(let level) = heading.kind {
            return .heading(level)
        }
        if components.contains(where: { if case .codeBlock = $0.kind { true } else { false } }) {
            return .code
        }
        if let item = components.first(where: { if case .listItem = $0.kind { true } else { false } }),
           case .listItem(let ordinal) = item.kind {
            let lists = components.compactMap { component -> Bool? in
                switch component.kind {
                case .orderedList: true
                case .unorderedList: false
                default: nil
                }
            }
            let marker = lists.first == true ? "\(ordinal)." : "•"
            return .listItem(marker: marker, depth: max(0, lists.count - 1))
        }
        if components.contains(where: { if case .blockQuote = $0.kind { true } else { false } }) {
            return .quote
        }
        return .paragraph
    }

    private static func linkBareURLs(in source: AttributedString) -> AttributedString {
        guard let detector = linkDetector else {
            return source
        }
        var result = source
        let text = String(result.characters)
        let matches = detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
        var searchStart = result.startIndex
        for match in matches {
            guard let url = match.url, ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  let stringRange = Range(match.range, in: text),
                  let range = result[searchStart...].range(of: String(text[stringRange])) else { continue }
            if !result[range].runs.contains(where: {
                $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true
            }) {
                result[range].link = url
            }
            searchStart = range.upperBound
        }
        return result
    }
}

struct MarkdownContent: View {
    enum Mode {
        case document
        case preview(lines: Int)
    }

    private let document: MarkdownDocument
    private let mode: Mode
    @ScaledMetric(relativeTo: .body) private var listIndent: CGFloat = 20
    @State private var openedLink: WebLink?

    init(_ source: String, mode: Mode = .document) {
        document = MarkdownDocument(source)
        self.mode = mode
    }

    init(document: MarkdownDocument, mode: Mode = .document) {
        self.document = document
        self.mode = mode
    }

    var body: some View {
        Group {
            switch mode {
            case .preview(let lines):
                Text(document.previewText)
                    .lineLimit(lines)
            case .document:
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(document.blocks, id: \.id) { block in
                        rendered(block)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .environment(\.openURL, OpenURLAction { url in
                    guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                        return .discarded
                    }
                    openedLink = WebLink(url: url)
                    return .handled
                })
                .linkBrowser($openedLink)
            }
        }
    }

    @ViewBuilder
    private func rendered(_ block: MarkdownDocument.Block) -> some View {
        switch block.kind {
        case .heading(let level):
            Text(block.content)
                .font(level == 1 ? .title2 : level == 2 ? .title3 : .headline)
                .fontWeight(.semibold)
                .accessibilityAddTraits(.isHeader)
        case .listItem(let marker, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(marker).frame(width: listIndent, alignment: .leading)
                Text(block.content)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, listIndent * CGFloat(depth))
        case .quote:
            Text(block.content)
                .foregroundStyle(.secondary)
                .padding(.leading, listIndent)
                .accessibilityHint("引用")
        case .code:
            ScrollView(.horizontal) {
                Text(block.content)
                    .font(.system(.body, design: .monospaced))
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(8)
            }
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        case .paragraph, .plain:
            Text(block.content)
        }
    }
}
