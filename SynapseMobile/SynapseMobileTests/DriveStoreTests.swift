import Foundation
import Testing
@testable import SynapseMobile

/// 云盘浏览状态里那些能单独拿出来判的东西：排序、批量结果、路径栈。
///
/// `DriveStore` 自己不在测试里：它的网络方法收的是 `APIClient`（actor），没有协议就注入
/// 不了假的，而本仓 `MeetingStore` 同样没有单测。会算错的部分都抽成了这个文件上面那些
/// 纯函数——它们按参数收排序偏好、不读 `UserDefaults`，所以这些断言是密闭的。
@MainActor
struct DriveStoreTests {
    private func item(
        _ id: String,
        _ name: String,
        folder: Bool = false,
        size: String = "0",
        updatedAt: String = "2026-09-25T02:11:00.000Z"
    ) -> DriveBrowserItem {
        DriveBrowserItem(
            id: id,
            name: name,
            type: folder ? .folder : .file,
            size: size,
            mimeType: nil,
            updatedAt: updatedAt,
            previewKind: .downloadOnly,
            browserUrl: "https://synapse.d2.pub/drive/browser/owner/items/\(id)",
            downloadUrl: folder ? nil : "https://synapse.d2.pub/drive/items/\(id)/download",
            shareUrl: nil
        )
    }

    private func names(_ items: [DriveBrowserItem]) -> [String] {
        items.map(\.name)
    }

    // MARK: - 排序

    @Test func foldersComeFirstInBothDirections() {
        // Spec §2.1：文件夹优先 + 名称升 / 降。方向说的是同一组里怎么排，不改变分组。
        // 名字用 ASCII：这里断的是分组与方向，不该顺带断言中文的排序规则（那是下一条的
        // 事，而且它依赖运行环境的 locale）。
        let items = [
            item("f1", "b.md"),
            item("d1", "docs", folder: true),
            item("f2", "a.md"),
            item("d2", "archive", folder: true),
        ]

        let ascending = DriveSort.sorted(items, by: .name, ascending: true)
        #expect(names(ascending) == ["archive", "docs", "a.md", "b.md"])

        let descending = DriveSort.sorted(items, by: .name, ascending: false)
        #expect(names(descending) == ["docs", "archive", "b.md", "a.md"])
    }

    @Test func nameSortKeepsChapterOrderForChineseNumerals() {
        // 「第 2 章」要排在「第 10 章」前面。逐字符比会得到相反的答案，所以这条钉的是
        // `localizedStandardCompare` 那一句没有被换掉。
        let items = [item("a", "第 10 章.md"), item("b", "第 2 章.md"), item("c", "第 1 章.md")]
        #expect(names(DriveSort.sorted(items, by: .name, ascending: true)) == ["第 1 章.md", "第 2 章.md", "第 10 章.md"])
    }

    @Test func sortsByDateSizeAndKind() {
        let items = [
            item("a", "旧报告.md", size: "100", updatedAt: "2026-09-20T02:11:00.000Z"),
            item("b", "新报告.md", size: "9000", updatedAt: "2026-09-24T02:11:00.000Z"),
            item("c", "照片.png", size: "5000", updatedAt: "2026-09-22T02:11:00.000Z"),
        ]

        // 日期：默认降序看的是「最近改的在上」。
        #expect(names(DriveSort.sorted(items, by: .date, ascending: false)) == ["新报告.md", "照片.png", "旧报告.md"])
        // 大小。
        #expect(names(DriveSort.sorted(items, by: .size, ascending: false)) == ["新报告.md", "照片.png", "旧报告.md"])
        // 种类：Spec §4.3 那张表的行序，PDF 与图片都在文档之前。
        let byKind = [item("a", "说明.md"), item("b", "报告.pdf"), item("c", "照片.png")]
        #expect(names(DriveSort.sorted(byKind, by: .kind, ascending: true)) == ["报告.pdf", "照片.png", "说明.md"])
    }

    @Test func unreadableValuesDoNotShuffleTheList() {
        // 读不出大小的按 0 算（与 `DriveText.bytes` 同一套兜底），读不出的时间按最早算：
        // 这两条都不能让它们在排序里忽大忽小。
        let items = [item("a", "未知大小.md", size: "unknown"), item("b", "一兆.md", size: "1000000")]
        #expect(names(DriveSort.sorted(items, by: .size, ascending: false)) == ["一兆.md", "未知大小.md"])

        let times = [item("a", "读不出的时间.md", updatedAt: "刚刚"), item("b", "旧文件.md", updatedAt: "2026-09-01T02:11:00.000Z")]
        #expect(names(DriveSort.sorted(times, by: .date, ascending: false)) == ["旧文件.md", "读不出的时间.md"])
    }

    @Test func equalValuesFallBackToTheName() {
        // 同值的项在 `sorted` 里没有确定顺序，而每一层都是重取的：不兜一条，同一份列表
        // 两次进来可能长得不一样。
        let items = [
            item("a", "c.md", size: "100"),
            item("b", "a.md", size: "100"),
            item("c", "b.md", size: "100"),
        ]
        #expect(names(DriveSort.sorted(items, by: .size, ascending: true)) == ["a.md", "b.md", "c.md"])
        // 方向跟着当前排序，不然「按大小降序」里同大小的那几行会按升序冒出来。
        #expect(names(DriveSort.sorted(items, by: .size, ascending: false)) == ["c.md", "b.md", "a.md"])
    }

    // MARK: - 路径栈

    @Test func drillingDownAndUpKeepsTheStackInOrder() {
        let root = item("root", "网盘", folder: true)
        let first = item("d1", "项目文档", folder: true)
        let second = item("d2", "附件", folder: true)

        // 根不进栈：它是服务端合成的，不是一层真实文件夹。
        var path = DrivePath.pushing(root, onto: [])
        #expect(path.isEmpty)

        path = DrivePath.pushing(first, onto: path)
        path = DrivePath.pushing(second, onto: path)
        #expect(path.map(\.id) == ["d1", "d2"])

        path = DrivePath.popping(path)
        #expect(path.map(\.id) == ["d1"])
        #expect(DrivePath.popping(DrivePath.popping(path)).isEmpty)
        // 已经在根层时原样返回，不会变成负数。
        #expect(DrivePath.popping([]).isEmpty)
    }

    @Test func filesNeverBecomeALayer() {
        // 点开一个文件是预览，不改变「现在在哪一层」。
        let file = item("f1", "报告.md")
        #expect(DrivePath.pushing(file, onto: []).isEmpty)
        #expect(DrivePath.pushing(file, onto: [item("d1", "项目文档", folder: true)]).map(\.id) == ["d1"])
    }

    // MARK: - 面包屑

    @Test func breadcrumbsUseThePhonesOwnNameForTheRoot() {
        // 服务端那条根叫「网盘」，那是桌面端的叫法；手机端补一条自己的「云盘」，
        // 并且只补这一条——两份都留着就会有两个根。
        let server = [
            DriveBreadcrumb(id: "root", name: "网盘", browserUrl: "https://synapse.d2.pub/drive/browser/owner/root"),
            DriveBreadcrumb(id: "d1", name: "项目文档", browserUrl: "https://synapse.d2.pub/drive/browser/owner/items/d1"),
            DriveBreadcrumb(id: "d2", name: "附件", browserUrl: "https://synapse.d2.pub/drive/browser/owner/items/d2"),
        ]
        let path = [item("d1", "项目文档", folder: true), item("d2", "附件", folder: true)]

        let trail = DrivePath.breadcrumbs(server: server, path: path)
        #expect(trail.map(\.name) == ["云盘", "项目文档", "附件"])
        #expect(trail.map(\.id) == ["root", "d1", "d2"])
        #expect(trail.first?.isRoot == true)
        // 根那一级带着服务端那条根的地址；手机端不用它跳转，但不能凭空丢一个字段。
        #expect(trail.first?.browserUrl == "https://synapse.d2.pub/drive/browser/owner/root")
    }

    @Test func breadcrumbsComeFromTheLocalStackAfterARename() {
        // 改名之后栈里那个名字是新的，服务端那份面包屑是这次请求那一刻的：级数与名字都
        // 以本地栈为准。
        let server = [DriveBreadcrumb(id: "root", name: "网盘", browserUrl: "")]
        let path = [item("d1", "改过名的文件夹", folder: true)]
        #expect(DrivePath.breadcrumbs(server: server, path: path).map(\.name) == ["云盘", "改过名的文件夹"])
    }

    @Test func jumpingByBreadcrumbTruncatesTheStack() {
        let path = [
            item("d1", "项目文档", folder: true),
            item("d2", "附件", folder: true),
            item("d3", "图片", folder: true),
        ]

        // 第 0 项是「云盘」：点它就是回根层。
        #expect(DrivePath.truncated(path, toDepth: 0).isEmpty)
        #expect(DrivePath.truncated(path, toDepth: 1).map(\.id) == ["d1"])
        #expect(DrivePath.truncated(path, toDepth: 3).map(\.id) == ["d1", "d2", "d3"])
        // 超出深度（列表比栈新一帧时可能发生）只取到栈底，不会越界。
        #expect(DrivePath.truncated(path, toDepth: 9).map(\.id) == ["d1", "d2", "d3"])
    }

    // MARK: - 移动到自己的子孙

    @Test func movingAFolderIntoItsOwnDescendantIsRefused() {
        let path = [
            item("d1", "项目文档", folder: true),
            item("d2", "附件", folder: true),
            item("d3", "图片", folder: true),
        ]

        // 它自己。
        #expect(!DrivePath.canMove(itemId: "d1", into: "d1", path: path))
        // 它的子孙：栈里在它后面每一级都是，当前这一层也是。
        #expect(!DrivePath.canMove(itemId: "d1", into: "d2", path: path))
        #expect(!DrivePath.canMove(itemId: "d1", into: "d3", path: path))
        // 反方向是合法的：把深的移进浅的。
        #expect(DrivePath.canMove(itemId: "d3", into: "d1", path: path))
        // 移到根永远合法。
        #expect(DrivePath.canMove(itemId: "d1", into: nil, path: path))
    }

    @Test func movingSomethingNotOnThePathIsLeftToTheServer() {
        // 栈里没有这一项时，本地无从判断目标是不是它的子孙：放行，服务端有自己的环检测。
        // 多拦一步只会把合法操作挡下来。
        let path = [item("d1", "项目文档", folder: true), item("d2", "附件", folder: true)]
        #expect(DrivePath.canMove(itemId: "elsewhere", into: "d2", path: path))
        // 但它移到它自己仍然是错的，这一条与栈无关。
        #expect(!DrivePath.canMove(itemId: "elsewhere", into: "elsewhere", path: path))
    }

    // MARK: - 批量结果

    @Test func batchKeepsGoingAfterOneFailure() async {
        // Spec §5.2：逐项报告，不做「全部成功才生效」。第一项成功之后的一项失败，
        // 不能把后面那些也停掉。
        let outcome = await DriveBatchOutcome.collecting(["a.txt", "b.txt", "c.txt"]) { name in
            name == "b.txt"
                ? DriveBatchOutcome.Failure(name: name, reason: "这一项不在你的云盘里。")
                : nil
        }

        #expect(outcome.succeeded == 2)
        #expect(outcome.failed == 1)
        // 后面那项确实做过了：成功的两项加上这一个失败正好是三项。
        #expect(outcome.total == 3)
        #expect(outcome.failures.map(\.name) == ["b.txt"])
        #expect(!outcome.isComplete)
        #expect(outcome.summary("删除") == "2 项删除成功，1 项失败")
        // 汇总只报数量，点名靠这一条。
        #expect(outcome.failureSentence == "「b.txt」这一项不在你的云盘里。")
    }

    @Test func batchSummarySpeaksTheSpecsWords() {
        let allDone = DriveBatchOutcome(succeeded: 3, failures: [])
        #expect(allDone.isComplete)
        #expect(allDone.summary("删除") == "3 项删除成功")
        #expect(allDone.failureSentence == nil)

        let noneDone = DriveBatchOutcome(
            succeeded: 0,
            failures: [
                .init(name: "a.txt", reason: "网络不可用，请稍后重试。"),
                .init(name: "b.txt", reason: "网络不可用，请稍后重试。"),
            ]
        )
        #expect(noneDone.summary("删除") == "2 项删除失败")
        #expect(noneDone.failureSentence == "「a.txt」网络不可用，请稍后重试。；「b.txt」网络不可用，请稍后重试。")

        // 一项都没选中：调用方据此不弹提示（按钮本来就是置灰的）。
        let nothing = DriveBatchOutcome(succeeded: 0, failures: [])
        #expect(nothing.isEmpty)
        #expect(!nothing.isComplete)
    }
}
