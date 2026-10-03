import SwiftUI

struct WorkspaceFilesContent: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Bindable var flow: WorkspaceFilesFlow
    let selection: WorkspaceFilesSelection
    let onReference: (String) async -> Bool
    let onClose: () -> Void
    let onReveal: () -> Void

    var body: some View {
        Group {
            if flow.wrapsLines {
                content
            } else {
                ScrollView(.horizontal) { content.fixedSize(horizontal: true, vertical: false) }
            }
        }
        .navigationTitle(selection.entry.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(selection.entry.name)
                    .font(.headline)
                    .dynamicTypeSize(dynamicTypeSize)
                    .accessibilityLabel(WorkspaceFilesContentLabels.filename(selection.entry.name))
                    .accessibilityAddTraits(.isHeader)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("关闭", systemImage: "xmark", action: onClose)
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier("files-detail-close")
            }
            ToolbarItem(placement: .primaryAction) {
                Menu("文件操作", systemImage: "ellipsis") {
                    if case .change(let entry) = selection {
                        Button("查看差异") { Task { await flow.select(selection) } }
                            .disabled(!flow.canRead)
                        Button("查看更改前") { Task { await flow.preview("before") } }
                            .disabled(entry.canPreviewBefore != true || !flow.canRead)
                        Button("查看更改后") { Task { await flow.preview("after") } }
                            .disabled(entry.canPreviewAfter != true || !flow.canRead)
                    }
                    Toggle("自动换行", isOn: $flow.wrapsLines)
                    if flow.contentLastPage?.format == "markdown", flow.markdownDocument != nil {
                        Toggle("显示 Markdown", isOn: $flow.rendersMarkdown)
                    }
                    if case .disk(let entry) = selection, entry.canReference == true, let id = entry.entryId {
                        Button("插入到输入框", systemImage: "text.insert") {
                            Task { if await onReference(id) { onClose() } }
                        }
                        .disabled(!flow.canRead || flow.isReferencing)
                    }
                    if case .disk = selection {
                        Button("在目录中显示", systemImage: "folder", action: onReveal)
                            .disabled(!flow.canRead || flow.locationState == .locating)
                    }
                }
                .accessibilityIdentifier("files-content-menu")
            }
        }
        .accessibilityIdentifier("files-content")
    }

    private var content: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 0) {
                WorkspaceFilesSelectableValue(value: flow.contentLastPage?.relativePath ?? selection.entry.relativePath)
                    .font(.footnote.monospaced()).foregroundStyle(.primary).padding(.vertical)
                if let oldPath = selection.entry.oldRelativePath {
                    selectableField("原路径", value: oldPath)
                }
                if let metadata = flow.contentLastPage?.metadata ?? selection.entry.metadata {
                    if let size = metadata.sizeBytes {
                        LabeledContent("大小") {
                            Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                .foregroundStyle(.primary)
                        }
                        .font(.footnote)
                    }
                    if let modified = metadata.modifiedAt,
                       let date = ISO8601DateFormatter.parseWireTimestamp(modified) {
                        LabeledContent("修改时间") {
                            Text(date.formatted(date: .abbreviated, time: .shortened))
                                .foregroundStyle(.primary)
                        }
                        .font(.footnote)
                    }
                }
                if let old = selection.entry.oldGitlink { selectableField("更改前引用", value: old) }
                if let new = selection.entry.newGitlink { selectableField("更改后引用", value: new) }
                if let failure = flow.failure {
                    Text(failure.message).foregroundStyle(Theme.failure).padding(.vertical)
                    if flow.canRead {
                        Button { Task { await flow.loadContent() } } label: {
                            Text("重试").frame(minHeight: Metrics.minimumTapTarget)
                        }
                    }
                }
                if let last = flow.contentLastPage {
                    if last.contentState != "available" {
                        Text(WorkspaceFilesContentLabels.contentState(last.contentState))
                            .foregroundStyle(.primary).padding(.vertical)
                    } else if let document = flow.markdownDocument, flow.rendersMarkdown {
                        MarkdownContent(document: document)
                    } else {
                        codeRows
                    }
                    if last.nextCursor != nil {
                        Button("加载更多") { Task { await flow.loadContent(next: true) } }
                            .frame(minHeight: Metrics.minimumTapTarget)
                            .disabled(!flow.canRead || flow.isReading)
                            .accessibilityIdentifier("files-content-next")
                    } else if last.completion == "truncated" {
                        Text(last.truncatedReason ?? "内容已截断。")
                            .font(.footnote).foregroundStyle(.primary).padding(.vertical)
                    }
                    if last.contentComplete == false { Text("内容尚未完整加载").font(.footnote).foregroundStyle(.primary) }
                } else if !flow.isReading {
                    Text(WorkspaceFilesContentLabels.contentState(selection.entry.unavailableReason ?? selection.entry.contentState))
                        .foregroundStyle(.primary)
                }
                if flow.isReading { ProgressView("等待电脑").padding(.vertical) }
            }
            .padding(.horizontal)
        }
    }

    private func selectableField(_ title: String, value: String) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.footnote)
            WorkspaceFilesSelectableValue(value: value)
        }
    }

    private var codeRows: some View {
        ForEach(flow.displayRows) { row in
            if row.isHeader {
                Text(row.text)
                    .font(.footnote.monospaced()).foregroundStyle(.primary)
                    .padding(.vertical)
                    .accessibilityLabel("差异片段，原文件第\(row.oldNumber ?? 0)行，新文件第\(row.newNumber ?? 0)行，\(row.text)")
            } else {
                WorkspaceCodeLine(kind: row.kind, oldNumber: row.oldNumber,
                    newNumber: row.newNumber, text: row.text, truncated: row.truncated,
                    isDiff: !flow.contentIsPreview, side: flow.previewSide)
            }
        }
    }

}

private struct WorkspaceCodeLine: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let kind: String
    let oldNumber: Int?
    let newNumber: Int?
    let text: String
    let truncated: Bool
    let isDiff: Bool
    let side: String?
    private var marker: String { kind == "addition" ? "+" : kind == "deletion" ? "−" : " " }
    private var label: String { kind == "addition" ? "新增" : kind == "deletion" ? "删除" : kind == "meta" ? "说明" : "上下文" }
    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading))
            : AnyLayout(HStackLayout(alignment: .top))
        layout {
            numbersAndMarker
            selectableText
        }
        .padding(.vertical, 2)
        .background(kind == "addition" ? Theme.diffAdditionFill : kind == "deletion" ? Theme.diffDeletionFill : Color.clear)
    }

    private var numbersAndMarker: some View {
        HStack(alignment: .top) {
            if isDiff {
                lineNumber(oldNumber)
                lineNumber(newNumber)
            } else { lineNumber(newNumber ?? oldNumber) }
            Text(marker).foregroundStyle(.primary).accessibilityHidden(true)
        }
    }

    private var selectableText: some View {
        Text(text + (truncated ? "…" : ""))
            .font(.system(.body, design: .monospaced))
            .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(.primary)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("\(label)\(spokenNumbers)，\(text)\(truncated ? "，本行已截断" : "")")
    }

    private var spokenNumbers: String {
        if isDiff {
            return (oldNumber.map { "，原文件第\($0)行" } ?? "") + (newNumber.map { "，新文件第\($0)行" } ?? "")
        }
        let source = side == "before" ? "更改前" : side == "after" ? "更改后" : ""
        return (newNumber ?? oldNumber).map { "，\(source)第\($0)行" } ?? ""
    }
    private func lineNumber(_ value: Int?) -> some View {
        Text(value.map(String.init) ?? "")
            .font(.footnote.monospacedDigit()).foregroundStyle(.primary)
            .frame(minWidth: 32, alignment: .trailing)
            .accessibilityHidden(true)
    }
}

/// Native read-only selection keeps the selectable control's actual bounds and
/// accessibility element together. UIFont supplies the Dynamic Type metrics.
struct WorkspaceFilesSelectableValue: UIViewRepresentable {
    let value: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textColor = .label
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != value {
            view.text = value
            view.invalidateIntrinsicContentSize()
        }
        updateFont(view, dynamicTypeSize: context.environment.dynamicTypeSize)
    }

    private func updateFont(_ view: UITextView, dynamicTypeSize: DynamicTypeSize) {
        let baseline = UITraitCollection(preferredContentSizeCategory: .large)
        let preferred = UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: baseline)
        let monospaced = UIFont(descriptor: preferred.fontDescriptor.withDesign(.monospaced) ?? preferred.fontDescriptor, size: 0)
        let traits = view.traitCollection.modifyingTraits {
            $0.preferredContentSizeCategory = UIContentSizeCategory(dynamicTypeSize)
        }
        let font = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: monospaced, compatibleWith: traits)
        if view.font != font {
            view.font = font
            view.invalidateIntrinsicContentSize()
            view.setNeedsLayout()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        // SwiftUI can measure before updateUIView during a Dynamic Type change.
        // Use the same environment font for that measurement, not the old font.
        updateFont(uiView, dynamicTypeSize: context.environment.dynamicTypeSize)
        let naturalWidth = (value as NSString).size(withAttributes: [.font: uiView.font ?? UIFont.preferredFont(forTextStyle: .footnote)]).width
        let width = proposal.width ?? naturalWidth
        guard width > 0 else { return nil }
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(Metrics.minimumTapTarget, size.height))
    }
}
