import Foundation
import Testing

@testable import SynapseMobile

/// 云盘对话框族里那些「看起来只是格式化」的东西。
///
/// 四个视图自己不好单测（要起 App、要网络），会算错的部分都抽成了纯函数：名字空不空、
/// 批量失败怎么说、移动目标里谁不该出现、结果页那几行字、简介那几行值。它们按参数收
/// 数据、不读 `UserDefaults`，所以这些断言是密闭的。
struct DriveDialogTests {
    private func item(
        _ id: String,
        _ name: String,
        folder: Bool = false,
        size: String = "0",
        updatedAt: String = "2026-09-25T02:11:00.000Z",
        shareUrl: String? = nil
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
            shareUrl: shareUrl
        )
    }

    private func share(
        shareId: String = "shr_1",
        url: String = "https://synapse.d2.pub/share/shr_1",
        urlWithPassword: String = "https://synapse.d2.pub/share/shr_1?pwd=abcd",
        passwordEnabled: Bool = false,
        password: String? = nil,
        expiresAt: String? = nil,
        accessMode: DriveAccessMode = .linkRead
    ) -> DriveShare {
        DriveShare(
            id: "rec_1",
            shareId: shareId,
            itemId: "i1",
            enabled: true,
            url: url,
            urlWithPassword: urlWithPassword,
            passwordEnabled: passwordEnabled,
            password: password,
            expiresAt: expiresAt,
            accessMode: accessMode,
            editorEmails: [],
            createdAt: "2026-09-25T02:11:00.000Z"
        )
    }

    // MARK: - 名字

    @Test func whitespaceOnlyNameIsNotAName() {
        #expect(!DriveRenameInput.isConfirmable(""))
        #expect(!DriveRenameInput.isConfirmable("   "))
        #expect(!DriveRenameInput.isConfirmable("\n\t "))
        #expect(DriveRenameInput.isConfirmable("a"))
        #expect(DriveRenameInput.isConfirmable(" 报告 "))
    }

    @Test func trimmedNameKeepsInnerSpaces() {
        #expect(DriveRenameInput.trimmed("  报告 2026 .pdf ") == "报告 2026 .pdf")
        // 只有两头被削掉：中间那个空格是名字的一部分。
        #expect(DriveRenameInput.trimmed("\n未命名文件夹\t") == "未命名文件夹")
    }

    // MARK: - 批量结果怎么说

    @Test func allSucceededSaysNothing() {
        let outcome = DriveBatchOutcome(succeeded: 3, failures: [])
        #expect(outcome.noticeText("移动") == nil)
    }

    @Test func emptyBatchSaysNothing() {
        #expect(DriveBatchOutcome(succeeded: 0, failures: []).noticeText("移动") == nil)
    }

    @Test func oneFailureNamesItWithoutCounting() {
        let outcome = DriveBatchOutcome(
            succeeded: 0,
            failures: [.init(name: "报告.pdf", reason: "网络不可用，请稍后重试。")]
        )
        #expect(outcome.noticeText("移动") == "移动失败：「报告.pdf」网络不可用，请稍后重试。")
    }

    @Test func partialFailureCountsAndNames() {
        let outcome = DriveBatchOutcome(
            succeeded: 2,
            failures: [.init(name: "b", reason: "没有权限。")]
        )
        #expect(outcome.noticeText("移动") == "2 项移动成功，1 项失败：「b」没有权限。")
    }

    @Test func severalFailuresAreAllNamed() {
        let outcome = DriveBatchOutcome(
            succeeded: 0,
            failures: [.init(name: "a", reason: "x"), .init(name: "b", reason: "y")]
        )
        #expect(outcome.noticeText("删除") == "2 项删除失败：「a」x；「b」y")
    }

    // MARK: - 移动目标

    @Test func movingItemItselfIsNotATarget() {
        let folder = item("f1", "报告", folder: true)
        let other = item("f2", "素材", folder: true)
        let selected = DriveMoveTargets.selectable(
            [folder, other],
            movingIds: [folder.id]
        )
        #expect(selected.map(\.id) == [other.id])
    }

    @Test func filesAndRootAreNeverTargets() {
        let file = item("i1", "a.pdf")
        let folder = item("f1", "报告", folder: true)
        let root = item("root", "网盘", folder: true)
        let selected = DriveMoveTargets.selectable([file, root, folder], movingIds: [])
        #expect(selected.map(\.id) == [folder.id])
    }

    @Test func multipleSelectionIsExcludedAsAWhole() {
        let a = item("a", "a", folder: true)
        let b = item("b", "b", folder: true)
        let c = item("c", "c", folder: true)
        let selected = DriveMoveTargets.selectable([a, b, c], movingIds: ["a", "c"])
        #expect(selected.map(\.id) == ["b"])
    }

    // MARK: - 分享结果页

    @Test func reusedShareSaysTheShareWasNotRebuilt() {
        // 说的是「没有新建一条」，不是「地址没变」：同一份 `DriveShare` 在这个判据下两种
        // 结论只差这一次的结果，文案要说的是前者。
        let outcome = DriveShareOutcome.reused(share())
        #expect(DriveShareSummary.headline(outcome) == "沿用已有分享，链接未变")
        #expect(DriveShareSummary.headline(.created(share())) == "链接已就绪")
    }

    @Test func summaryLineCarriesNameModeAndExpiry() {
        #expect(
            DriveShareSummary.line(itemName: "报告.pdf", share: share())
                == "报告.pdf · 仅阅读 · 永久有效"
        )
        #expect(
            DriveShareSummary.line(
                itemName: "报告.pdf",
                share: share(accessMode: .linkEdit)
            ) == "报告.pdf · 登录后可编辑 · 永久有效"
        )
    }

    @Test func missingExpiryMeansForever() {
        #expect(DriveShareSummary.expiry(nil) == "永久有效")
        #expect(DriveShareSummary.expiry("") == "永久有效")
        // 读不出来的时间戳按永久说，不留半句话。
        #expect(DriveShareSummary.expiry("不是时间") == "永久有效")
    }

    @Test func expiryIsReadFromTheServerTimestamp() {
        // 具体日期跟着日历走（同一年只报月日），这里只钉「服务端给了就按它说」。
        #expect(DriveShareSummary.expiry("2030-01-01T00:00:00.000Z").hasPrefix("有效期至 "))
    }

    // MARK: - 简介

    @Test func kindCarriesTheExtension() {
        #expect(DriveItemInfo.kind(item("i1", "报告.PDF")) == "PDF 文件")
        #expect(DriveItemInfo.kind(item("i2", "readme")) == "文件")
        // 点在开头的不算扩展名。
        #expect(DriveItemInfo.kind(item("i3", ".gitignore")) == "文件")
        #expect(DriveItemInfo.kind(item("f1", "报告", folder: true)) == "文件夹")
        // 文件夹不看扩展名：一个叫 `2026.09 归档` 的文件夹不是「09 文件」。
        #expect(DriveItemInfo.kind(item("f2", "2026.09 归档", folder: true)) == "文件夹")
    }

    @Test func folderHasNoSizeAndUnknownSizeIsADash() {
        #expect(DriveItemInfo.size(item("f1", "报告", folder: true)) == "—")
        #expect(DriveItemInfo.size(item("i1", "a.pdf", size: "220000")) == "220 KB")
        // 超出 Int64 的 size 读不出来 —— 不能报「0 字节」。
        #expect(DriveItemInfo.size(item("i2", "b.pdf", size: "99999999999999999999999")) == "—")
    }

    @Test func unreadableTimestampsAreADash() {
        #expect(
            DriveItemInfo.modified(item("i1", "a.pdf", updatedAt: "2020-03-05T02:11:00.000Z"))
                == "2020年3月5日"
        )
        #expect(DriveItemInfo.modified(item("i2", "b.pdf", updatedAt: "")) == "—")
    }

    @Test func locationSpellsOutTheWholePath() {
        #expect(DriveItemInfo.location(path: [], name: "报告.pdf") == "云盘 / 报告.pdf")
        let path = [item("f1", "项目", folder: true), item("f2", "2026", folder: true)]
        #expect(
            DriveItemInfo.location(path: path, name: "报告.pdf")
                == "云盘 / 项目 / 2026 / 报告.pdf"
        )
    }
}
