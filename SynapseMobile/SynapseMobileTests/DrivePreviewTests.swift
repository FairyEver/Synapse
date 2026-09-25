import Foundation
import Testing
@testable import SynapseMobile

/// 预览与导出里能单独拿出来判的那几条：走哪条路、文本读到哪停、什么时候先问一句、
/// 落地那一份叫什么。
///
/// 都是纯函数——不读 `UserDefaults`、不碰网络、不起视图，所以这些断言是密闭的。
/// `DrivePreviewContent` 与 `DriveFileExport` 的网络那一半不在这里：它们收的是
/// `APIClient`（actor），没有协议就注入不了假的，与本仓 `DriveStore` 的处理一致。
@MainActor
struct DrivePreviewTests {
    // MARK: - 走哪条路

    @Test func imageKindGoesToTheLocalImage() {
        #expect(DrivePreviewRoute.route(kind: .image, name: "照片.HEIC") == .image)
    }

    @Test func theThreeTextKindsKeepTheirKind() {
        // 三种读法一样、画法不同（Markdown 渲染、HTML 源码走等宽），所以种类要带着走。
        #expect(DrivePreviewRoute.route(kind: .text, name: "说明.txt") == .text(.text))
        #expect(DrivePreviewRoute.route(kind: .markdown, name: "需求规格.md") == .text(.markdown))
        #expect(DrivePreviewRoute.route(kind: .htmlSource, name: "页面.html") == .text(.htmlSource))
    }

    @Test func officeAndPDFGoToQuickLook() {
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "报告.pdf") == .quickLook)
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "文档.docx") == .quickLook)
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "表格.xlsx") == .quickLook)
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "胶片.pptx") == .quickLook)
    }

    @Test func everythingElseIsOnlyExportable() {
        // 压缩包、音视频、代码，iOS 自己都打不开：硬交给 QuickLook 只会弹一片空白。
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "归档.zip") == .unavailable)
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "视频.mp4") == .unavailable)
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "配置.json") == .unavailable)
        // 没有扩展名的一个也不猜。
        #expect(DrivePreviewRoute.route(kind: .downloadOnly, name: "未知") == .unavailable)
    }

    // MARK: - 读多少

    private func chunk(
        start: Int,
        end: Int,
        total: Int = 200_000,
        cursor: String? = "next",
        endOfFile: Bool = false
    ) -> DriveContentChunk {
        DriveContentChunk(
            itemId: "item",
            versionId: "v1",
            text: "",
            startByte: start,
            endByte: end,
            totalBytes: total,
            nextCursor: cursor,
            endOfFile: endOfFile
        )
    }

    @Test func keepsReadingWhileTheChunksAdvance() {
        #expect(DriveTextPreview.shouldContinue(previousEnd: 0, chunk: chunk(start: 0, end: 8196)))
        #expect(DriveTextPreview.shouldContinue(previousEnd: 8196, chunk: chunk(start: 8196, end: 16392)))
    }

    @Test func stopsAtTheEndOfTheFile() {
        #expect(!DriveTextPreview.shouldContinue(
            previousEnd: 0,
            chunk: chunk(start: 0, end: 120, total: 120, cursor: nil, endOfFile: true)
        ))
        // 到头了但游标还在：`endOfFile` 一个就够。
        #expect(!DriveTextPreview.shouldContinue(
            previousEnd: 0,
            chunk: chunk(start: 0, end: 120, total: 120, cursor: "next", endOfFile: true)
        ))
    }

    @Test func stopsWhenThereIsNoCursorLeft() {
        #expect(!DriveTextPreview.shouldContinue(
            previousEnd: 0,
            chunk: chunk(start: 0, end: 8196, total: 120_000, cursor: nil)
        ))
    }

    @Test func stopsAtTheSixtyFourKilobyteLimit() {
        // 还没顶到上限，接着读。
        #expect(DriveTextPreview.shouldContinue(previousEnd: 57_344, chunk: chunk(start: 57_344, end: 65_000)))
        // 正好顶到 64 KiB 就停：读到的正是「开头 64 KiB」这个量，一行不多。
        #expect(!DriveTextPreview.shouldContinue(previousEnd: 57_340, chunk: chunk(start: 57_340, end: 65_536)))
        #expect(!DriveTextPreview.shouldContinue(previousEnd: 65_536, chunk: chunk(start: 65_536, end: 73_732)))
    }

    @Test func stopsWhenTheCursorDoesNotAdvance() {
        // 游标不前进时再问一次还是同一段，接着问就是死循环。
        #expect(!DriveTextPreview.shouldContinue(previousEnd: 8196, chunk: chunk(start: 0, end: 8196)))
    }

    @Test func truncationNoteOnlyWhenSomethingIsLeft() {
        #expect(DriveTextPreview.truncationNote(shownBytes: 65_536, totalBytes: 200_000) == "已显示前 64 KB")
        // 读全了没有这一行。
        #expect(DriveTextPreview.truncationNote(shownBytes: 120, totalBytes: 120) == nil)
        // 一个字节都没读出来时也不说「已显示前 0 KB」。
        #expect(DriveTextPreview.truncationNote(shownBytes: 0, totalBytes: 120) == nil)
    }

    // MARK: - 先问一句

    private func file(_ name: String, size: String, folder: Bool = false) -> DriveBrowserItem {
        DriveBrowserItem(
            id: name,
            name: name,
            type: folder ? .folder : .file,
            size: size,
            mimeType: nil,
            updatedAt: "2026-09-25T02:11:00.000Z",
            previewKind: .downloadOnly,
            browserUrl: "https://synapse.d2.pub/drive/browser/owner/items/\(name)",
            downloadUrl: folder ? nil : "https://synapse.d2.pub/drive/items/\(name)/download",
            shareUrl: nil
        )
    }

    @Test func smallFilesAreNotWorthAskingAbout() {
        #expect(DriveFileExport.confirmationTotal(for: [file("a.pdf", size: "1200")]) == nil)
        // 正好 50 MB 不问：判据是「超过」，不是「达到」。
        #expect(DriveFileExport.confirmationTotal(for: [file("a.pdf", size: "50000000")]) == nil)
    }

    @Test func oneBigFileAsksWithTheWholeBatchTotal() {
        let big = file("大.zip", size: "50000001")
        let small = file("小.txt", size: "1200")
        // 报的是这一批的总量：一次多选问一次就够，逐项问会变成一串弹窗。
        #expect(DriveFileExport.confirmationTotal(for: [big, small]) == 50_001_201)
    }

    @Test func anUnreadableSizeDoesNotBlockTheDownload() {
        // 量不到大小不等于它是大文件：为一句「可能很大」拦住一次本来能做完的下载不划算。
        #expect(DriveFileExport.confirmationTotal(for: [file("a.pdf", size: "")]) == nil)
        #expect(DriveFileExport.confirmationTotal(for: [file("a.pdf", size: "不明")]) == nil)
        // 但它不该把同批里那个真的大文件盖掉。
        #expect(
            DriveFileExport.confirmationTotal(for: [file("a.pdf", size: "不明"), file("b.zip", size: "60000000")])
                == 60_000_000
        )
    }

    // MARK: - 落地那一份叫什么

    @Test func stagedFileKeepsItsOwnName() {
        // 面板上、「存储到文件」之后、QuickLook 按什么打开它，认的都是这个名字。中文、
        // 空格、括号都是它本来的样子，一个都不动。
        #expect(DriveFileExport.stagedName(for: file("需求规格.md", size: "1")) == "需求规格.md")
        #expect(DriveFileExport.stagedName(for: file("季度 报告 (终).pdf", size: "1")) == "季度 报告 (终).pdf")
    }

    @Test func foldersLandAsAZip() {
        // 文件夹那条路由服务端压成 zip 回来，名字跟着它变。
        #expect(DriveFileExport.stagedName(for: file("照片", size: "1", folder: true)) == "照片.zip")
        // 服务端已经这么叫了就不叠一个 .zip.zip。
        #expect(DriveFileExport.stagedName(for: file("照片.zip", size: "1", folder: true)) == "照片.zip")
        // 文件没有这一层：它的名字是什么就是什么。
        #expect(DriveFileExport.stagedName(for: file("归档.zip", size: "1")) == "归档.zip")
    }

    @Test func stagedNameNeverEscapesTheStagingDirectory() {
        // 名字里带一个 / 会让 URL 指到别的目录去，所以只剥路径分隔符。
        #expect(DriveFileExport.stagedName(for: file("子目录/报告.pdf", size: "1")) == "报告.pdf")
        #expect(DriveFileExport.stagedName(for: file(" 报告.pdf ", size: "1")) == "报告.pdf")
        #expect(DriveFileExport.stagedName(for: file("   ", size: "1")) == "下载")
    }

    // MARK: - 同批重名

    @Test func uniqueKeepsTheFirstOneUntouched() {
        #expect(DriveFileExport.unique("报告.pdf", taken: []) == "报告.pdf")
    }

    @Test func uniqueCountsUpOnARepeat() {
        // 云盘允许同一层有同名文件，而面板拿到两个同名 URL 时用户分不出哪个是哪个。
        #expect(DriveFileExport.unique("报告.pdf", taken: ["报告.pdf"]) == "报告 (2).pdf")
        #expect(
            DriveFileExport.unique("报告.pdf", taken: ["报告.pdf", "报告 (2).pdf"]) == "报告 (3).pdf"
        )
        // 没有扩展名的手上不加一个点。
        #expect(DriveFileExport.unique("README", taken: ["README"]) == "README (2)")
    }
}
