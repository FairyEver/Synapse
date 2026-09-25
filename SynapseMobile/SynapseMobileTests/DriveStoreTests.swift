import Foundation
import Testing
@testable import SynapseMobile

/// 云盘那几个屏里能单独拿出来判的东西：排序、批量结果、路径栈、回收站恢复分流、
/// 分享请求体、复用判定与链接变没变、公开素材直链、搜索词归一。
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

    // MARK: - 回收站

    private func trashEntry(
        _ id: String,
        kind: String = "normal",
        assetId: String? = nil,
        name: String = "报告.md"
    ) -> DriveTrashEntry {
        DriveTrashEntry(
            id: id,
            kind: kind,
            name: name,
            type: .file,
            size: "1024",
            mimeType: "text/markdown",
            originalPath: "/项目文档",
            assetId: assetId,
            trashedAt: "2026-09-24T02:11:00.000Z"
        )
    }

    @Test func restoringSendsEachKindToItsOwnRoute() {
        // 回收站那一份列表里混着两类条目，恢复却是两条接口。走错的表现是 404，与「服务端
        // 没有这个能力」分不开，所以分流必须钉在这里。
        #expect(DriveTrashRestore.target(for: trashEntry("itm_1")) == .item(itemId: "itm_1"))
        #expect(DriveTrashRestore.target(for: trashEntry("itm_2", kind: "public_asset", assetId: "ast_1"))
            == .publicAsset(assetId: "ast_1"))
        // 普通项走的是它自己的 `id`：列表里那一行本来就是一条 DriveItem。
        #expect(DriveTrashRestore.target(for: trashEntry("itm_3")) == .item(itemId: "itm_3"))
        // 说是公开素材却没给 `assetId`（DTO 里那个字段是可选的）：本地拼不出那条路径，
        // 说它恢复不了，而不是发一个注定 404 的请求。
        #expect(DriveTrashRestore.target(for: trashEntry("itm_4", kind: "public_asset")) == nil)
        #expect(DriveTrashRestore.target(for: trashEntry("itm_5", kind: "public_asset", assetId: "")) == nil)
    }

    // MARK: - 分享

    private func shareListItem(
        _ id: String,
        itemId: String = "itm_1",
        itemName: String = "报告.md",
        password: String = "pw"
    ) -> DriveShareListItem {
        DriveShareListItem(
            id: id,
            shareId: id,
            itemId: itemId,
            itemName: itemName,
            itemType: .file,
            sourceDeleted: false,
            url: "https://synapse.d2.pub/s/\(id)",
            urlWithPassword: "https://synapse.d2.pub/s/\(id)?password=\(password)",
            passwordEnabled: true,
            password: password,
            expiresAt: nil,
            accessMode: .linkRead,
            editorEmails: [],
            createdAt: "2026-09-24T02:11:00.000Z"
        )
    }

    /// 三态里是不是「链接未变」。`DriveShareOutcome` 没有 `Equatable`（它装的是整条分享），
    /// 所以断言从这一条路走。
    private func isReused(_ outcome: DriveShareOutcome) -> Bool {
        if case .reused = outcome { return true }
        return false
    }

    /// 请求体编成 JSON 之后的样子。断言的是**真正发出去的那几个键**——空体与服务端嘴里的
    /// 「没给设置」是一回事，所以键在不在比字段的值更关键。
    private func shareBody(_ settings: APIClient.DriveShareSettings) throws -> [String: Any] {
        let data = try JSONEncoder().encode(settings)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    @Test func theShareResultCarriesCopyableLinks() {
        // 结果页上那三行「拷贝」取的直接就是这几个字符串（Spec §4.5）。映射少带一个字段，
        // 「拷贝」就拷到空的东西。
        let share = DriveShare(listItem: shareListItem("shr_1"))
        #expect(share.url == "https://synapse.d2.pub/s/shr_1")
        #expect(share.urlWithPassword == "https://synapse.d2.pub/s/shr_1?password=pw")
        #expect(share.password == "pw")
        #expect(share.shareId == "shr_1")
        #expect(share.itemId == "itm_1")
        #expect(share.accessMode == .linkRead)
        // 服务端的分享列表只给还活着的那几条（`enabled: true` 且没过期），所以从列表里
        // 出来的这一条一定是开着的。
        #expect(share.enabled)
    }

    @Test func anExistingShareIsReusedInsteadOfCreatedAgain() {
        let known = [shareListItem("shr_1")]

        // 用户什么都没改，本机手里就有那一条：不发请求，直接用。
        switch DriveSharePlan.of(itemId: "itm_1", known: known, settings: APIClient.DriveShareSettings()) {
        case .useExisting(let existing):
            #expect(existing.url == "https://synapse.d2.pub/s/shr_1")
        case .request:
            Issue.record("已有那一条时不该再发一次创建请求")
        }

        // 改过设置就得发：带设置去的那一次在服务端是「更新」，本机说不出更新完是什么样。
        var changed = DriveShareForm.defaults
        changed.expiry = .sevenDays
        switch DriveSharePlan.of(
            itemId: "itm_1",
            known: known,
            settings: changed.settings(changedFrom: .defaults)
        ) {
        case .useExisting:
            Issue.record("改过设置时应当发请求")
        case .request(let body):
            #expect(body.expiresIn == .sevenDays)
        }

        // 本机不知道这一项有分享（分享列表还没拉过）：照样发一次——服务端会复用那一条，
        // 回来的链接不变，多花的只是一次请求。
        switch DriveSharePlan.of(itemId: "itm_1", known: [], settings: APIClient.DriveShareSettings()) {
        case .useExisting:
            Issue.record("本机不知道时应当发请求")
        case .request:
            break
        }

        // 别项的分享不算它的：判据是 `itemId`，不是列表里有没有东西。
        #expect(DriveSharePlan.existing(forItemId: "itm_9", in: known) == nil)
    }

    @Test func theReuseVerdictFollowsTheShareId() {
        let before = DriveShare(listItem: shareListItem("shr_1"))

        // 还是同一个编号：结果页要说「链接未变」。
        #expect(isReused(DriveShareOutcome.resolving(before, previousShareId: "shr_1")))

        // 带设置的那一次在服务端是**更新**，`passwordEnabled: true` 被显式发出时密码会被
        // 重算，`urlWithPassword` 与 `password` 都换，而 `shareId` 不变（`buildDriveShareUrl`
        // 只从它拼地址）——「链接未变」说的是地址，不是密码。
        let recalculated = DriveShare(listItem: shareListItem("shr_1", password: "pw2"))
        #expect(isReused(DriveShareOutcome.resolving(recalculated, previousShareId: "shr_1")))
        switch DriveShareOutcome.resolving(recalculated, previousShareId: "shr_1") {
        case .reused(let share):
            // 结果页上「拷贝密码」拷的是这一份，旧的那个已经不好使了。
            #expect(share.password == "pw2")
        case .created, .failed:
            Issue.record("同一个 shareId 时应当说链接未变")
        }

        // 先停用再分享同一项：服务端是**新建**（新的 shareId、新的地址），而本机手里那份
        // 浏览行快照还停在「有分享」上。只看「本来有没有一条」会说「链接未变」——用户据此
        // 以为链接还是老的那条，实际拿到的是一条全新的地址。比编号就没有这个缝。
        let fresh = DriveShare(listItem: shareListItem("shr_2"))
        #expect(!isReused(DriveShareOutcome.resolving(fresh, previousShareId: before.shareId)))
        switch DriveShareOutcome.resolving(fresh, previousShareId: before.shareId) {
        case .created(let share):
            #expect(share.shareId == "shr_2")
        case .reused, .failed:
            Issue.record("换了 shareId 时不该说链接未变")
        }

        // 本机完全不知道这一项有分享（分享列表没拉过、浏览行也说是 nil）时按新建算；
        // 空串（浏览行给了个空字符串）与「没有」同等看待。
        #expect(!isReused(DriveShareOutcome.resolving(before, previousShareId: nil)))
        #expect(!isReused(DriveShareOutcome.resolving(before, previousShareId: "")))
    }

    @Test func browseRowsCarryAShareIdNotAPublicLink() {
        // 浏览行上那个 `shareUrl` 是**站内路径**（`buildShareDriveBrowserUrl`），不是公开链接，
        // 而服务端给的 `url` 带 `APP_PUBLIC_URL`：两个字符串永远不相等，能对上的只有编号。
        #expect(DriveShareLink.shareId(inBrowserPath: "/share/shr_1") == "shr_1")
        // 在别人的分享里浏览时，路径上还带着项目那一段。
        #expect(DriveShareLink.shareId(inBrowserPath: "/share/shr_1/items/itm_2") == "shr_1")
        #expect(DriveShareLink.shareId(inBrowserPath: "/share/shr_1?from=list") == "shr_1")

        // 没分享过的那一行是 nil，路径里也没有 `/share/` 那一段。
        #expect(DriveShareLink.shareId(inBrowserPath: nil) == nil)
        #expect(DriveShareLink.shareId(inBrowserPath: "") == nil)
        #expect(DriveShareLink.shareId(inBrowserPath: "/console/drive/itm_1") == nil)
        #expect(DriveShareLink.shareId(inBrowserPath: "/share/") == nil)
    }

    @Test func theShareBodyOnlyCarriesWhatTheUserChanged() throws {
        // 服务端把请求里的设置**叠在**已有那条分享之上（`resolveShareAccessSettingsBase`），
        // 没发过去的键保持原样。所以没动过的键不能发：密码那一项发过去会被重算一次，
        // 「带密码的链接」换了地址，而用户什么都没改。
        let initial = DriveShareForm.defaults

        // 一项都没动：空体。服务端把空体当成「没给设置」，正好是复用那一条路。
        #expect(try shareBody(initial.settings(changedFrom: initial)).isEmpty)

        var expiry = initial
        expiry.expiry = .thirtyDays
        let expiryBody = try shareBody(expiry.settings(changedFrom: initial))
        #expect(expiryBody.keys.sorted() == ["expiresIn"])
        #expect(expiryBody["expiresIn"] as? String == "30d")

        // 打开密码：只发这一项。
        var passwordOn = initial
        passwordOn.passwordEnabled = true
        let onBody = try shareBody(passwordOn.settings(changedFrom: initial))
        #expect(onBody.keys.sorted() == ["passwordEnabled"])
        #expect(onBody["passwordEnabled"] as? Bool == true)

        // 关掉密码时 `false` 得**跟着键一起发**：服务端把「没这个键」读成「别动它」，
        // 少发一个键，本来设了密码的那条分享会继续带着密码。
        var passwordOff = passwordOn
        passwordOff.passwordEnabled = false
        let offBody = try shareBody(passwordOff.settings(changedFrom: passwordOn))
        #expect(offBody.keys.sorted() == ["passwordEnabled"])
        #expect(offBody["passwordEnabled"] as? Bool == false)

        var mode = initial
        mode.accessMode = .linkEdit
        #expect(try shareBody(mode.settings(changedFrom: initial))["accessMode"] as? String == "link_edit")

        // 指定邮箱可编辑：名单一起发。
        var specified = initial
        specified.accessMode = .specifiedUsersEdit
        specified.editorEmails = ["a@b.com"]
        let specifiedBody = try shareBody(specified.settings(changedFrom: initial))
        #expect(specifiedBody.keys.sorted() == ["accessMode", "editorEmails"])
        #expect(specifiedBody["editorEmails"] as? [String] == ["a@b.com"])

        // 别的档位上服务端会把名单清空（`normalizeDriveAccessSettings`），所以发它只是白搭。
        var emailsOnly = initial
        emailsOnly.editorEmails = ["a@b.com"]
        #expect(try shareBody(emailsOnly.settings(changedFrom: initial)).isEmpty)

        // 表单是照已有那条的当前样子打开的，所以「什么都没动」的基线是它自己：拿它和默认值
        // 比，四项就都是「动过」的，一个都不能少发——把某一项漏掉（或整条空体发出去），
        // 服务端会把这项留在原档上，用户看到的是自己没动过的设置变回去了。
        let existing = DriveShareForm(
            expiry: .oneYear,
            passwordEnabled: true,
            accessMode: .specifiedUsersEdit,
            editorEmails: ["a@b.com"]
        )
        let fullBody = try shareBody(existing.settings(changedFrom: .defaults))
        #expect(fullBody.keys.sorted() == ["accessMode", "editorEmails", "expiresIn", "passwordEnabled"])
        #expect(fullBody["accessMode"] as? String == "specified_users_edit")
        #expect(fullBody["editorEmails"] as? [String] == ["a@b.com"])
        #expect(fullBody["passwordEnabled"] as? Bool == true)

        // 同一套值拿它自己当基线才是空体——那正是「打开已有分享、什么都没动」的那一次。
        #expect(try shareBody(existing.settings(changedFrom: existing)).isEmpty)
    }

    // MARK: - 公开素材直链

    private func publicAsset(_ assetId: String, url: String = "https://synapse.d2.pub/files/ast_1") -> DrivePublicAsset {
        DrivePublicAsset(
            assetId: assetId,
            itemId: "itm_\(assetId)",
            name: "\(assetId).png",
            size: "2048",
            mimeType: "image/png",
            url: url,
            lifecycleStatus: "active",
            accessCount: "3",
            responseBytes: "6144",
            lastAccessedAt: nil,
            createdAt: "2026-09-24T02:11:00.000Z",
            updatedAt: "2026-09-24T02:11:00.000Z"
        )
    }

    @Test func publicAssetLinksPointAtTheFilesRoute() {
        // 直链挂在 `/files/:assetId` 上，不在 `/api` 前缀下。
        #expect(DrivePublicAssetLink.url(assetId: "ast_1", origin: URL(string: "https://synapse.d2.pub")!)
            == "https://synapse.d2.pub/files/ast_1")
        #expect(DrivePublicAssetLink.url(assetId: "ast_2", origin: URL(string: "http://localhost:3000")!)
            == "http://localhost:3000/files/ast_2")

        // 服务端给了 `url` 就用它的：那一条按产品的公开站点地址拼，与手机连的是哪个源站
        // 无关——这正是「直链」该有的样子。
        #expect(DrivePublicAssetLink.directLink(
            for: publicAsset("ast_1"),
            origin: URL(string: "https://other.test")!
        ) == "https://synapse.d2.pub/files/ast_1")

        // 没给（旧服务端）才自己拼一条兜底：「拷贝直链」不该拷到空串。
        #expect(DrivePublicAssetLink.directLink(
            for: publicAsset("ast_3", url: "  "),
            origin: URL(string: "https://other.test")!
        ) == "https://other.test/files/ast_3")
    }

    // MARK: - 搜索词

    @Test func blankSearchIsNotASearchTerm() {
        // 空串与纯空白都是「没有搜索词」：`?search=` 是白拼一个参数，而本机「这一份列表是
        // 搜什么搜出来的」多出两种写法之后，恢复一条再重取就可能带着一个空词去。
        #expect(DriveSearchTerm.normalized(nil) == nil)
        #expect(DriveSearchTerm.normalized("") == nil)
        #expect(DriveSearchTerm.normalized("   ") == nil)
        #expect(DriveSearchTerm.normalized(" 报告 ") == "报告")
    }
}
