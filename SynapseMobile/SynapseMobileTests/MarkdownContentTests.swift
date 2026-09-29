import Foundation
import Testing
@testable import SynapseMobile

struct MarkdownContentTests {
    @Test func plainTextAndReleaseMailBecomeParagraphsAndLists() {
        let plain = MarkdownDocument("普通正文。\n下一行。")
        #expect(plain.blocks.count == 1)
        #expect(plain.blocks[0].kind == .paragraph)
        #expect(plain.previewText == "普通正文。 下一行。")

        let release = MarkdownDocument("新增功能\n- 第一项\n\n功能优化\n- 第二项\n\n更新地址：https://synapse.d2.pub/desktop/update")
        #expect(release.blocks.map(\.kind) == [
            .paragraph, .listItem(marker: "•", depth: 0),
            .paragraph, .listItem(marker: "•", depth: 0), .paragraph
        ])
        #expect(release.previewText.contains("新增功能 · 第一项"))
        #expect(!release.previewText.contains("- 第一项"))
    }

    @Test func headingsNestedListsQuotesAndCodeRetainBlockSemantics() {
        let document = MarkdownDocument("""
        # 标题

        1. 第一项
        2. 第二项
           - 内层

        > 引用

        ```swift
        let answer = 42
        ```
        """)
        #expect(document.blocks.map(\.kind) == [
            .heading(1),
            .listItem(marker: "1.", depth: 0),
            .listItem(marker: "2.", depth: 0),
            .listItem(marker: "•", depth: 1),
            .quote, .code
        ])
        #expect(document.blocks.last?.text.contains("let answer = 42") == true)
    }

    @Test func inlineFormattingAndLinksSurviveParsing() {
        let document = MarkdownDocument("**粗体**、*斜体*、[链接](https://example.com) 和 https://synapse.d2.pub/desktop/update")
        let runs = document.blocks[0].content.runs
        #expect(runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
        #expect(runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
        #expect(runs.compactMap(\.link).count == 2)

        let code = MarkdownDocument("`https://example.com` 和 https://synapse.d2.pub")
        #expect(code.blocks[0].content.runs.compactMap(\.link).count == 1)
    }

    @Test func unsupportedBlocksRemainReadableAndMalformedSourceDoesNotDisappear() {
        let table = "| A | B |\n|---|---|\n| 甲 | 乙 |"
        #expect(MarkdownDocument(table).blocks[0].kind == .plain)
        #expect(MarkdownDocument(table).blocks[0].text == table)

        let image = "图片 ![说明](https://example.com/image.png)"
        #expect(MarkdownDocument(image).blocks[0].text == image)

        let unfinished = "一段没有关闭的 `代码"
        #expect(!MarkdownDocument(unfinished).previewText.isEmpty)
    }

    @Test func previewRemovesMarkupWithoutMakingLinksInteractive() {
        let document = MarkdownDocument("## 标题\n\n- **重点**和[链接](https://example.com)")
        #expect(document.previewText == "标题 · 重点和链接")
        #expect(!document.previewText.contains("##"))
        #expect(!document.previewText.contains("**"))
    }
}
