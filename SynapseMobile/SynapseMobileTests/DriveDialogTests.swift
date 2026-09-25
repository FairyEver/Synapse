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

    // MARK: - 有没有分享：读出来的是哪一种

    @Test func aMissingShareIsNotAFailure() {
        // 服务端说没有这一条（404）→ `missing`：那是「现在没有能用的分享」，下面摆表单。
        #expect(
            DriveShareLookup.of(APIError(status: 404, code: nil, message: "分享不存在。"))
                == .missing
        )
    }

    @Test func anythingElseCountsAsNotRead() {
        // 别的都不是「没有」。这两条下面**不能**接「建一条」：读不动与没有是两件事，
        // 混起来一次抖动就变成一条用户没要的分享。
        #expect(
            DriveShareLookup.of(APIError(status: 500, code: nil, message: "服务器开小差了。"))
                == .failed(reason: "服务器开小差了。")
        )
        // 断网（transport）有自己的说法，不把服务端那句空话摆给用户。
        #expect(
            DriveShareLookup.of(APIError(status: 0, code: nil, message: ""))
                == .failed(reason: DriveText.offlineErrorMessage)
        )
    }

    // MARK: - 指定邮箱的名单

    @Test func splittingNeedsEverySeparatorTheChineseKeyboardOffers() {
        // 半角逗号、全角逗号、顿号、换行、全角空格都要切：只切半角逗号的话，中文输入法下
        // 敲出来的名单会整段落到服务端，而那边不切分（`drive-share-access.ts`）。
        let text = "a@x.com, b@x.com，c@x.com、d@x.com\ne@x.com　f@x.com g@x.com"
        #expect(
            DriveShareEditors.parse(text)
                == .ready([
                    "a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com", "g@x.com",
                ])
        )
    }

    @Test func aSeparatorAtTheEdgeIsDroppedNotGluedOn() {
        // 这一段里最要紧的三条：`a@x.com,` 那种形态服务端是**收得下**的（`com,` 仍然满足
        // `[^\s@]+`），存下来是一条谁也对不上的地址，而且没有任何错误。
        #expect(DriveShareEditors.parse("a@x.com,") == .ready(["a@x.com"]))
        #expect(DriveShareEditors.parse("a@x.com，") == .ready(["a@x.com"]))
        #expect(DriveShareEditors.parse("、a@x.com") == .ready(["a@x.com"]))
        // 空格把两个地址挤在一起时，是两个，不是一段。
        #expect(DriveShareEditors.parse("a@x.com b@x.com") == .ready(["a@x.com", "b@x.com"]))
    }

    @Test func lowercasedAndDedupedInTheOrderWritten() {
        // 小写之后去重（`A@x.com` 与 `a@x.com` 是同一个人），留下的顺序是用户写的顺序。
        #expect(
            DriveShareEditors.parse("B@x.com a@x.com b@x.com")
                == .ready(["b@x.com", "a@x.com"])
        )
    }

    @Test func anInvalidTokenIsNamed() {
        // 说出是哪一段：服务端只会回一句「可编辑用户邮箱无效。」，指不出地方。
        #expect(DriveShareEditors.parse("a@x.com not-an-email") == .invalid(token: "not-an-email"))
        // 只有 @ 没有点不算邮箱（与服务端那条正则一致）。
        #expect(DriveShareEditors.parse("a@x") == .invalid(token: "a@x"))
        // 名字对的那一段照旧过。
        #expect(DriveShareEditors.parse("a@x.com") == .ready(["a@x.com"]))
    }

    @Test func semicolonsSplitToo() {
        // 分号与逗号同一类：`a@x.com;` 里那个 `;` 既不是空白也不是 `@`，服务端那条正则收得下。
        #expect(
            DriveShareEditors.parse("a@x.com;b@x.com；c@x.com")
                == .ready(["a@x.com", "b@x.com", "c@x.com"])
        )
        #expect(DriveShareEditors.parse("a@x.com；") == .ready(["a@x.com"]))
    }

    @Test func theListHintOnlyAppearsOnTheTierThatNeedsOne() {
        // 别的档位上这一页没有邮箱输入框，说一句「请至少填一个邮箱。」就是在指一件这一页上
        // 没有的操作——默认档位就是「仅阅读」，一打开就会撞上。
        #expect(DriveShareEditors.hint(text: "", mode: .linkRead) == nil)
        #expect(DriveShareEditors.hint(text: "", mode: .linkEdit) == nil)
        #expect(DriveShareEditors.hint(text: "", mode: .specifiedUsersEdit) == "请至少填一个邮箱。")
        #expect(
            DriveShareEditors.hint(text: "abc", mode: .specifiedUsersEdit)
                == "「abc」不是邮箱地址。"
        )
        // 名单没问题就不说。
        #expect(DriveShareEditors.hint(text: "a@x.com", mode: .specifiedUsersEdit) == nil)
    }

    @Test func nothingTypedIsEmpty() {
        #expect(DriveShareEditors.parse("") == .empty)
        // 只有分隔符也是空：这些都不能当成「一段地址」发出去。
        #expect(DriveShareEditors.parse("  \n 、 ") == .empty)
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
        // 读出来的时刻跟着机器所在时区走（`DriveText.date` 用的是本机日历，这是它该有的
        // 语义），所以只钉「服务端给了就按它说」，不钉哪一天：钉死日期的话这台机器跑到
        // UTC−3 以西就挂了（02:11Z 在那儿还是 3 月 4 日）。
        #expect(
            DriveItemInfo.modified(item("i1", "a.pdf", updatedAt: "2020-03-05T02:11:00.000Z"))
                .hasPrefix("2020年3月")
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
