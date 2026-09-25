import Foundation
import Testing

@testable import SynapseMobile

/// 浏览界面（Task 6）里那几段「看起来只是格式化」的东西。
///
/// 这一屏自己不好单测：它要起 App、要网络、要一个真的 `SynapseAppModel`。会算错的部分都
/// 抽成了纯函数（`DriveBrowserRow` / `DriveBrowserHeader` / `DriveBrowserSelection` /
/// `DriveUploadRow` / `DriveUsageRow` / `DriveBrowserLayer`），它们按参数收数据、不读
/// `UserDefaults`，所以下面的断言是密闭的。
///
/// 这些字是**行与组里唯一的说明**：一行的两行字全靠副标题分出「空的」与「读不出的」，
/// 上传那一组全靠那行小字分出「在传」与「等你确认」。所以每一条都值一个断言。
struct DriveBrowserTests {
    private let updatedAt = "2026-09-19T10:00:00.000Z"

    private func item(
        _ name: String = "报告.pdf",
        id: String = "i1",
        folder: Bool = false,
        size: String = "2048",
        updatedAt: String? = nil,
        shareUrl: String? = nil
    ) -> DriveBrowserItem {
        DriveBrowserItem(
            id: id,
            name: name,
            type: folder ? .folder : .file,
            size: size,
            mimeType: nil,
            updatedAt: updatedAt ?? self.updatedAt,
            previewKind: .downloadOnly,
            browserUrl: "https://synapse.d2.pub/drive/items/\(id)",
            downloadUrl: nil,
            shareUrl: shareUrl
        )
    }

    private func upload(
        _ state: DriveUploadItem.State,
        progress: Double = 0,
        target: DriveUploadOverwriteTarget? = nil,
        name: String = "大图.png"
    ) -> DriveUploadItem {
        DriveUploadItem(
            id: "u1",
            file: PickedFile(
                url: URL(fileURLWithPath: "/tmp/\(name)"),
                name: name,
                size: 1024,
                mimeType: nil
            ),
            parentId: nil,
            expectedItemId: nil,
            state: state,
            progress: progress
        )
    }

    // MARK: - 行副标题

    @Test func aFileSaysItsSizeAndWhenItChanged() {
        let subject = item(size: "2048")
        #expect(
            DriveBrowserRow.subtitle(for: subject)
                == "\(DriveText.bytes("2048")) · \(DriveText.date(updatedAt))"
        )
    }

    /// 文件夹没有大小这一格：服务端给的那个数是它自己节点的，报出来会小得离谱。
    @Test func aFolderSaysOnlyWhenItChanged() {
        let subject = item("设计稿", folder: true, size: "0")
        #expect(DriveBrowserRow.subtitle(for: subject) == DriveText.date(updatedAt))
    }

    /// 读不出大小的那一项说「—」，**不**说「0 字节」。
    ///
    /// `DriveText.bytes(_:)` 把「读不出来」与「0 字节」渲染成同一个结果，所以判据必须是
    /// `sizeBytes`（`Int64?`）：超出 `Int64` 的那个大整数字符串正好落进前一种，照字符串
    /// 走会把一个超大文件说成空的。
    @Test func anUnreadableSizeIsADashNotZeroBytes() {
        let subject = item(size: "99999999999999999999999")
        #expect(subject.sizeBytes == nil)
        #expect(DriveBrowserRow.size(subject) == "—")
        #expect(DriveBrowserRow.subtitle(for: subject).hasPrefix("— · "))
    }

    /// 真的 0 字节要说出来：那是「这个文件是空的」，与上一件事不同。
    @Test func aZeroByteFileSaysZero() {
        let subject = item(size: "0")
        #expect(subject.sizeBytes == 0)
        #expect(DriveBrowserRow.size(subject) == DriveText.bytes("0"))
        #expect(!DriveBrowserRow.subtitle(for: subject).hasPrefix("—"))
    }

    /// 时间戳认不出来时那一段说「—」，不留一格空白，也不留一个吊在末尾的「 · 」。
    @Test func anUnreadableTimeIsADash() {
        let subject = item(folder: true, updatedAt: "")
        #expect(DriveBrowserRow.updatedAt(subject) == "—")
        #expect(DriveBrowserRow.subtitle(for: subject) == "—")
    }

    @Test func onlyAnActiveShareGetsTheLinkBadge() {
        #expect(!DriveBrowserRow.isShared(item(shareUrl: nil)))
        #expect(!DriveBrowserRow.isShared(item(shareUrl: "")))
        #expect(DriveBrowserRow.isShared(item(shareUrl: "https://synapse.d2.pub/share/abc")))
    }

    @Test func theOpenActionIsNamedAfterTheKind() {
        #expect(DriveBrowserRow.openLabel(item("设计稿", folder: true)) == "打开")
        #expect(DriveBrowserRow.openLabel(item()) == "预览")
    }

    /// 文件夹不能导出：服务端那条下载路由认的是单个文件。菜单里这一条置灰而不是藏起来，
    /// 所以这个判据决定的是「灰不灰」，不是「在不在」。
    @Test func foldersCannotBeExported() {
        #expect(!DriveBrowserRow.canExport(item("设计稿", folder: true)))
        #expect(DriveBrowserRow.canExport(item()))
    }

    // MARK: - 计数行

    @Test func theCountLineSaysCountKeyAndDirection() {
        #expect(DriveBrowserHeader.countLine(count: 12, key: .name, ascending: true) == "12 项 · 按名称升序")
        #expect(DriveBrowserHeader.countLine(count: 0, key: .size, ascending: false) == "0 项 · 按大小降序")
        #expect(DriveBrowserHeader.direction(ascending: false) == "降序")
    }

    // MARK: - 多选

    @Test func theBarSaysHowManyArePicked() {
        #expect(DriveBrowserSelection.countLabel(0) == "已选 0 项")
        #expect(DriveBrowserSelection.countLabel(3) == "已选 3 项")
    }

    /// 一颗键在「全选」与「取消全选」之间来回。
    @Test func theToggleGoesFromNothingToEverythingAndBack() {
        let items = [item("a", id: "a"), item("b", id: "b")]
        #expect(!DriveBrowserSelection.isAll(picked: [], in: items))
        #expect(DriveBrowserSelection.toggleTitle(picked: [], in: items) == "全选")
        let all = DriveBrowserSelection.toggled(picked: [], in: items)
        #expect(all == ["a", "b"])
        #expect(DriveBrowserSelection.isAll(picked: all, in: items))
        #expect(DriveBrowserSelection.toggleTitle(picked: all, in: items) == "取消全选")
        #expect(DriveBrowserSelection.toggled(picked: all, in: items).isEmpty)
    }

    /// 空的一层永远不算「全选」：否则空列表上那颗键会写着「取消全选」。
    @Test func anEmptyLayerIsNeverAll() {
        #expect(!DriveBrowserSelection.isAll(picked: [], in: []))
        #expect(DriveBrowserSelection.toggleTitle(picked: [], in: []) == "全选")
    }

    /// 选中的项里，已经不在这一层的那些落掉（别人删了、这一层重取过）。
    @Test func onlyTheRowsStillHereCount() {
        let items = [item("a", id: "a"), item("b", id: "b")]
        #expect(DriveBrowserSelection.items(["a", "gone"], in: items).map(\.id) == ["a"])
        #expect(DriveBrowserSelection.items([], in: items).isEmpty)
    }

    // MARK: - 上传那一组

    @Test func theUploadRowSaysWhatItIsDoing() {
        #expect(DriveUploadRow.detail(upload(.queued)) == "等待上传")
        #expect(DriveUploadRow.detail(upload(.uploading, progress: 0.42)) == "42%")
        #expect(DriveUploadRow.detail(upload(.completed(itemId: "i9"))) == "已完成")
        #expect(DriveUploadRow.detail(upload(.failed("网络不可用"))) == "网络不可用")
        #expect(
            DriveUploadRow.detail(
                upload(.awaitingOverwrite(DriveUploadOverwriteTarget(
                    itemId: "i2",
                    name: "大图.png",
                    currentVersionId: nil,
                    documentText: false
                )))
            ) == "已有同名文件"
        )
    }

    /// 进度条只画在真的在排、在传的项上：等确认覆盖的那一项一个字节都没发出去，
    /// 画一条 0% 的进度条是在说一件没发生的事。
    @Test func onlyMovingUploadsShowAProgressBar() {
        #expect(DriveUploadRow.showsProgress(upload(.queued)))
        #expect(DriveUploadRow.showsProgress(upload(.uploading, progress: 0.5)))
        #expect(!DriveUploadRow.showsProgress(upload(.completed(itemId: "i9"))))
        #expect(!DriveUploadRow.showsProgress(upload(.failed("x"))))
    }

    /// 「还在动」那三档右侧给的是「取消」；停下来那两档给「重试」与「移除」。
    @Test func threeStatesAreStillRunning() {
        #expect(DriveUploadRow.isRunning(upload(.queued)))
        #expect(DriveUploadRow.isRunning(upload(.uploading)))
        #expect(!DriveUploadRow.isRunning(upload(.completed(itemId: "i9"))))
        #expect(!DriveUploadRow.isRunning(upload(.failed("x"))))
    }

    /// 只有「等确认覆盖」那一档要那一颗「覆盖」。
    @Test func onlyTheAwaitingOverwriteStateNeedsAConfirmation() {
        let target = DriveUploadOverwriteTarget(
            itemId: "i2",
            name: "日记.md",
            currentVersionId: nil,
            documentText: true
        )
        #expect(DriveUploadRow.needsOverwrite(upload(.awaitingOverwrite(target))))
        #expect(!DriveUploadRow.needsOverwrite(upload(.uploading)))
        #expect(!DriveUploadRow.needsOverwrite(upload(.queued)))
        #expect(!DriveUploadRow.needsOverwrite(upload(.completed(itemId: "i9"))))
        #expect(!DriveUploadRow.needsOverwrite(upload(.failed("x"))))
    }

    /// 这一档同时算「还在动」（右侧有「取消」）与「要确认」：两颗都要有。
    @Test func theAwaitingOverwriteStateIsBothRunningAndAsking() {
        let target = DriveUploadOverwriteTarget(
            itemId: "i2",
            name: "日记.md",
            currentVersionId: nil,
            documentText: true
        )
        let subject = upload(.awaitingOverwrite(target))
        #expect(DriveUploadRow.isRunning(subject))
        #expect(DriveUploadRow.needsOverwrite(subject))
        #expect(!DriveUploadRow.showsProgress(subject))
    }

    // MARK: - 用量

    @Test func theUsageLineIsUsedOverQuota() {
        let usage = DriveUsage(usedBytes: "1500000000", reservedBytes: "0", quotaBytes: "5000000000")
        #expect(
            DriveUsageRow.text(for: usage)
                == "已用 \(DriveText.bytes("1500000000")) / \(DriveText.bytes("5000000000"))"
        )
    }

    /// 读不出来的用量整个不显示：一个半截的「已用 」比没有这一行更糟。
    @Test func anUnreadableUsageSaysNothingAtAll() {
        #expect(DriveUsageRow.text(for: nil) == nil)
        #expect(
            DriveUsageRow.text(
                for: DriveUsage(usedBytes: "很多", reservedBytes: "0", quotaBytes: "5000000000")
            ) == nil
        )
        #expect(
            DriveUsageRow.text(
                for: DriveUsage(usedBytes: "1024", reservedBytes: "0", quotaBytes: "很多")
            ) == nil
        )
    }

    // MARK: - 失败的那几项留下来

    /// 部分失败时选择要恢复成**失败的那几项**（Spec §5.2「成功的从列表移除，失败的保留选中」）：
    /// 它们还在列表里，选择留给它们，用户再按一次就是重试。
    ///
    /// 断言里特意放两个同名项：名字恢复不了选择，只有 id 能。
    @Test func onlyTheFailedItemsKeepTheirSelection() {
        let outcome = DriveBatchOutcome(
            succeeded: 1,
            failures: [
                .init(itemId: "b", name: "报告.pdf", reason: "网络不可用，请稍后重试。"),
                .init(itemId: "c", name: "报告.pdf", reason: "这一项不在你的云盘里。"),
            ]
        )
        #expect(outcome.failedItemIds == ["b", "c"])
    }

    /// 全成时那一批一个都不留：选择照旧被清掉（用户按完「删除」不该还剩着东西）。
    @Test func aFullSuccessLeavesNothingSelected() {
        #expect(DriveBatchOutcome(succeeded: 3, failures: []).failedItemIds.isEmpty)
    }

    /// 对象不是云盘项的那几种批次（新建文件夹、分享）没有 id 可给：收出来是空集，
    /// 而不是把列表里某一行瞎选上。
    @Test func aFailureWithoutAnIdSelectsNothing() {
        let outcome = DriveBatchOutcome(
            succeeded: 0,
            failures: [.init(name: "日记", reason: "网络不可用，请稍后重试。")]
        )
        #expect(outcome.failedItemIds.isEmpty)
    }

    // MARK: - 一页

    /// 上传落到哪儿认的是它：根层给 nil —— 服务端把根当成「没有父级」，而 `"root"` 在它
    /// 那边是一个要去库里找的真实文件夹。
    @Test func theRootLayerHasNoFolderId() {
        #expect(DriveBrowserLayer.root.folderId == nil)
        #expect(DriveBrowserLayer.root.isRoot)
        #expect(DriveBrowserLayer.folder(item("设计稿", id: "f1")).folderId == "f1")
        #expect(!DriveBrowserLayer.folder(item("设计稿", id: "f1")).isRoot)
    }
}
