import Foundation
import Testing
@testable import SynapseMobile

/// 云盘这条通道上真正发出去的路径。
///
/// 纯字符串断言，不联网：路径拼错在真请求上表现成 404，而 404 与「服务端根本没有这个能力」
/// 长得一模一样，只有把字符串钉住才说得清是哪一边的问题。
///
/// 基址取的是 `AppConfiguration.defaultAPIBaseURL`（装在手机上的那一版用的就是它），
/// 而不是 `apiBaseURL` —— 后者是 `UserDefaults` 里的值，`AppConfigurationTests` 会临时改它，
/// 而测试是并行的。
struct DriveAPIContractTests {
    /// 与 `APIClient.perform` 拼 URL 的方式同一条：基址 + 路径。
    private func url(_ path: String) -> String {
        AppConfiguration.defaultAPIBaseURL + path
    }

    // MARK: - 浏览

    @Test func browsesUnderTheAPIPrefix() {
        #expect(url(APIClient.DriveRoute.root(childrenOffset: nil, childrenLimit: nil))
            == "https://synapse.d2.pub/api/drive/browser/owner/root")
        #expect(url(APIClient.DriveRoute.root(childrenOffset: 0, childrenLimit: 50))
            == "https://synapse.d2.pub/api/drive/browser/owner/root?childrenOffset=0&childrenLimit=50")
        // 控制台的这一档是写死的：回来的是同一批 id、同一套权限。
        #expect(url(APIClient.DriveRoute.itemSnapshot(itemId: "itm_1", childrenOffset: nil, childrenLimit: nil))
            == "https://synapse.d2.pub/api/drive/browser/owner/items/itm_1?surface=console")
        #expect(url(APIClient.DriveRoute.itemSnapshot(itemId: "itm_1", childrenOffset: 50, childrenLimit: 50))
            == "https://synapse.d2.pub/api/drive/browser/owner/items/itm_1?surface=console&childrenOffset=50&childrenLimit=50")
    }

    // MARK: - 项

    @Test func mutatesItemsUnderTheAPIPrefix() {
        #expect(url(APIClient.DriveRoute.createFolder) == "https://synapse.d2.pub/api/drive/folders")
        // 改名、移动、移入回收站是同一条路径，动作在方法与请求体上。
        #expect(url(APIClient.DriveRoute.item(itemId: "itm_1")) == "https://synapse.d2.pub/api/drive/items/itm_1")
        #expect(url(APIClient.DriveRoute.restoreItem(itemId: "itm_1"))
            == "https://synapse.d2.pub/api/drive/items/itm_1/restore")
    }

    // MARK: - 回收站与分享

    @Test func listsTheTrashAndShares() {
        #expect(url(APIClient.DriveRoute.trash(offset: 0, limit: 50, search: nil))
            == "https://synapse.d2.pub/api/drive/trash?offset=0&limit=50")
        // 搜索走服务端，参数名是 `search`。
        #expect(url(APIClient.DriveRoute.trash(offset: nil, limit: nil, search: "q3"))
            == "https://synapse.d2.pub/api/drive/trash?search=q3")
        #expect(url(APIClient.DriveRoute.hideTrashItem(id: "tr_1")) == "https://synapse.d2.pub/api/drive/trash/tr_1")
        #expect(url(APIClient.DriveRoute.restorePublicAsset(assetId: "ast_1"))
            == "https://synapse.d2.pub/api/drive/public-assets/ast_1/restore")

        #expect(url(APIClient.DriveRoute.share(itemId: "itm_1")) == "https://synapse.d2.pub/api/drive/items/itm_1/share")
        #expect(url(APIClient.DriveRoute.shares(offset: 0, limit: 50))
            == "https://synapse.d2.pub/api/drive/shares?offset=0&limit=50")
        #expect(url(APIClient.DriveRoute.disableShare(id: "shr_1")) == "https://synapse.d2.pub/api/drive/shares/shr_1")
    }

    // MARK: - 用量与公开素材

    @Test func listsUsageAndPublicAssets() {
        #expect(url(APIClient.DriveRoute.usage) == "https://synapse.d2.pub/api/drive/usage")
        #expect(url(APIClient.DriveRoute.publicAssets(offset: 0, limit: 50, search: nil))
            == "https://synapse.d2.pub/api/drive/public-assets?offset=0&limit=50")
        #expect(url(APIClient.DriveRoute.preparePublicAssetUpload)
            == "https://synapse.d2.pub/api/drive/public-assets/uploads/prepare")
        #expect(url(APIClient.DriveRoute.completePublicAssetUpload(sessionId: "ups_1"))
            == "https://synapse.d2.pub/api/drive/public-assets/uploads/ups_1/complete")
        // 改名与移入回收站是同一条路径。
        #expect(url(APIClient.DriveRoute.publicAsset(assetId: "ast_1")) == "https://synapse.d2.pub/api/drive/public-assets/ast_1")
    }

    // MARK: - 文本内容

    @Test func readsTextContent() {
        #expect(url(APIClient.DriveRoute.contentInspect(itemId: "itm_1"))
            == "https://synapse.d2.pub/api/drive/browser/owner/items/itm_1/content/inspect")
        #expect(url(APIClient.DriveRoute.contentChunk(itemId: "itm_1", versionId: "v1", cursor: nil))
            == "https://synapse.d2.pub/api/drive/browser/owner/items/itm_1/content/chunk?versionId=v1")
        #expect(url(APIClient.DriveRoute.contentChunk(itemId: "itm_1", versionId: "v1", cursor: "next"))
            == "https://synapse.d2.pub/api/drive/browser/owner/items/itm_1/content/chunk?versionId=v1&cursor=next")
    }

    // MARK: - 下载

    /// 这一条要钉的是「前面**没有** `/api`」。
    ///
    /// 服务端把它注册在 `@Controller()` 的绝对路径上，多一个前缀就是 404 —— 而 404 与
    /// 「服务端没这个能力」长得一样。`DriveModelsTests` 里那份服务端响应样例里的
    /// `downloadUrl` 也是这个形状（`https://<origin>/drive/items/…/download`）。
    ///
    /// 源站是**传进去**的，不走 `driveDownloadURL`：那条路会读 `UserDefaults` 里的基址，
    /// 而 `AppConfigurationTests` 在并行用例里会改写它（有一例正是 `…/apiary`）。
    /// 断言一个会被别人同时改的输入，挂了也说不清是谁的问题。`apiOrigin` 自己的派生
    /// 由 `AppConfigurationTests` 覆盖，这里只负责「接上那条路由之后是什么样」。
    @Test func theDownloadRouteIsNotUnderTheAPIPrefix() throws {
        let origin = try #require(URL(string: "https://synapse.d2.pub"))
        let download = APIClient.DriveRoute.download(itemId: "itm_1", origin: origin)

        #expect(download == "https://synapse.d2.pub/drive/items/itm_1/download")
        #expect(!download.contains("/api/"))
        #expect(try #require(URL(string: download)).path == "/drive/items/itm_1/download")
    }

    // MARK: - id 的编码

    /// 路径里的 id 一律按路径段编码，不能把查询串或片段带进来。
    @Test func escapesIdsInPathSegments() {
        #expect(url(APIClient.DriveRoute.item(itemId: "a b"))
            == "https://synapse.d2.pub/api/drive/items/a%20b")
        #expect(url(APIClient.DriveRoute.item(itemId: "a?b"))
            == "https://synapse.d2.pub/api/drive/items/a%3Fb")
        #expect(url(APIClient.DriveRoute.trash(offset: nil, limit: nil, search: "报告")).contains("search=%E6%8A%A5%E5%91%8A"))
    }

    // MARK: - 上传票据

    /// prepare 的响应里那份「目标位置已有同名文件」在**顶层**，整块缺失就是「不知道」。
    ///
    /// 旧服务端整个键都不返回，而「缺失」必须解码成功 —— 解不出来就等于**所有**上传都
    /// 在 prepare 这一步失败，且看起来像服务端坏了。两种响应都钉一遍：`documentText`
    /// 是服务端每次都会给的（`drive.service.ts`），所以它是必填的，不是可选的。
    @Test func readsTheOverwriteTargetFromTheTopLevelAndToleratesItsAbsence() throws {
        let base = """
        {"sessionId":"ups_1","item":{"id":"itm_1","name":"报告.md","size":"12"},
         "upload":{"method":"PUT","url":"https://bucket.example.com/k","expiresAt":"2026-09-25T10:00:00.000Z","headers":{}}}
        """

        let withoutOverwrite = try JSONDecoder().decode(
            APIClient.DriveUploadTicket.self,
            from: Data(base.utf8)
        )
        #expect(withoutOverwrite.overwrite == nil)
        #expect(withoutOverwrite.sessionId == "ups_1")

        let withOverwrite = try JSONDecoder().decode(
            APIClient.DriveUploadTicket.self,
            from: Data(
                """
                {"sessionId":"ups_1","item":{"id":"itm_1","name":"报告.md","size":"12"},
                 "upload":{"method":"PUT","url":"https://bucket.example.com/k","expiresAt":"2026-09-25T10:00:00.000Z","headers":{}},
                 "overwrite":{"itemId":"itm_old","name":"报告.md","currentVersionId":"v3","documentText":true}}
                """.utf8
            )
        )
        #expect(withOverwrite.overwrite?.itemId == "itm_old")
        #expect(withOverwrite.overwrite?.currentVersionId == "v3")
        #expect(withOverwrite.overwrite?.documentText == true)
    }

    // MARK: - 请求体

    /// 改名只发 `name`。
    ///
    /// 服务端按「体里有没有 `name`」分流，而 `renameSchema` 是 `.strict()`：多带一个键
    /// 整条会被拒。所以移动与改名必须是两个体，不能合成一个带两个可选字段的。
    @Test func renameBodyCarriesOnlyTheName() throws {
        let body = try JSONEncoder().encode(APIClient.DriveRenameBody(name: "报告.md"))
        #expect(String(data: body, encoding: .utf8) == #"{"name":"报告.md"}"#)
    }

    /// `parentId: nil` 的移动要发**显式**的 `null`。
    ///
    /// 服务端的 `moveSchema` 里 `parentId` 可空但不可缺（没有 `.optional()`），而
    /// `JSONEncoder` 默认会把值为 nil 的键整个省掉 —— 省掉的后果是「移到根目录」被判成
    /// 「移动请求无效」，也就是这个动作根本做不了。
    @Test func movingToTheRootSendsAnExplicitNull() throws {
        let toRoot = try JSONEncoder().encode(APIClient.DriveMoveBody(parentId: nil))
        #expect(String(data: toRoot, encoding: .utf8) == #"{"parentId":null}"#)

        let intoAFolder = try JSONEncoder().encode(APIClient.DriveMoveBody(parentId: "itm_folder"))
        #expect(String(data: intoAFolder, encoding: .utf8) == #"{"parentId":"itm_folder"}"#)
    }

    /// 没说要什么就不发那个键：服务端拿它自己的默认值定，客户端不替它决定。
    @Test func shareSettingsOnlyCarryWhatWasAsked() throws {
        let empty = try JSONEncoder().encode(APIClient.DriveShareSettings())
        #expect(String(data: empty, encoding: .utf8) == "{}")

        let encoder = JSONEncoder()
        // 键的顺序不是契约，内容才是。
        encoder.outputFormatting = [.sortedKeys]
        let full = try encoder.encode(
            APIClient.DriveShareSettings(passwordEnabled: true, expiresIn: .sevenDays, accessMode: .linkRead)
        )
        // `expiresIn` 的取值就是 `DriveExpiry` 的原始值（"7d"），不是枚举名。
        #expect(String(data: full, encoding: .utf8) == #"{"accessMode":"link_read","expiresIn":"7d","passwordEnabled":true}"#)
    }
}
