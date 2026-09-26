import Foundation
import Testing
@testable import SynapseMobile

/// 导出里能单独拿出来判的那几条：什么时候先问一句、落地那一份叫什么、同一批重名怎么排。
///
/// 都是纯判据 —— 不读 `UserDefaults`、不碰网络、不起视图，所以这些断言是密闭的。
/// `DriveFileExport` 的网络那一半不在这里：它收的是 `APIClient`（actor），没有协议就注入
/// 不了假的，与本仓 `DriveStore` 的处理一致。
@MainActor
struct DriveExportTests {
    private func file(_ name: String, size: String, folder: Bool = false) -> DriveBrowserItem {
        DriveBrowserItem(
            id: name,
            name: name,
            type: folder ? .folder : .file,
            size: size,
            mimeType: nil,
            updatedAt: "2026-09-25T02:11:00.000Z",
            previewKind: .downloadOnly,
            browserUrl: "/drive/items/\(name)",
            downloadUrl: folder ? nil : "/drive/items/\(name)/download",
            shareUrl: nil
        )
    }

    // MARK: - 先问一句

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
        // 面板上、「存储到文件」之后，认的都是这个名字。中文、空格、括号都是它本来的样子，
        // 一个都不动。
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
