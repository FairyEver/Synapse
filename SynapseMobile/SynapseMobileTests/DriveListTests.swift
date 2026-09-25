import Foundation
import Testing

@testable import SynapseMobile

/// 三个列表屏（回收站 / 公开素材 / 分享管理）行副标题那几段「看起来只是格式化」的东西。
///
/// 三张视图自己不好单测（要起 App、要网络），会算错的部分都抽成了纯函数：副标题哪几段在、
/// 缺一段时怎么办。它们按参数收数据、不读 `UserDefaults`，所以这些断言是密闭的。
///
/// 副标题是这些行**唯一**的说明：名字一样的两条分享只靠它分辨，所以缺一段或多一个吊着的
/// 「 · 」都是用户看得见的错。
struct DriveListTests {
    private let movedAt = "2026-09-19T10:00:00.000Z"

    private func entry(
        _ name: String,
        originalPath: String? = "设计稿/旧版首页.png",
        trashedAt: String = "2026-09-19T10:00:00.000Z",
        folder: Bool = false,
        publicAsset: Bool = false
    ) -> DriveTrashEntry {
        DriveTrashEntry(
            id: "tr-1",
            kind: publicAsset ? "public_asset" : "normal",
            name: name,
            type: folder ? .folder : .file,
            size: "51200",
            mimeType: nil,
            originalPath: originalPath,
            assetId: publicAsset ? "ast_5KQ8M2XT" : nil,
            trashedAt: trashedAt
        )
    }

    private func asset(
        _ name: String,
        accessCount: String = "42",
        lastAccessedAt: String? = "2026-09-25T08:12:00.000Z"
    ) -> DrivePublicAsset {
        DrivePublicAsset(
            assetId: "ast_7F3KQ2M9XT",
            itemId: "i1",
            name: name,
            size: "512000",
            mimeType: "image/png",
            url: "https://synapse.d2.pub/files/ast_7F3KQ2M9XT",
            lifecycleStatus: "active",
            accessCount: accessCount,
            responseBytes: "512000",
            lastAccessedAt: lastAccessedAt,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z"
        )
    }

    private func share(
        itemName: String = "报告-2026Q3.xlsx",
        accessMode: DriveAccessMode = .linkRead,
        passwordEnabled: Bool = false,
        expiresAt: String? = nil,
        sourceDeleted: Bool = false
    ) -> DriveShareListItem {
        DriveShareListItem(
            id: "rec_1",
            shareId: "shr_1",
            itemId: "i1",
            itemName: itemName,
            itemType: .file,
            sourceDeleted: sourceDeleted,
            url: "https://synapse.d2.pub/share/shr_1",
            urlWithPassword: "https://synapse.d2.pub/share/shr_1?pwd=abcd",
            passwordEnabled: passwordEnabled,
            password: nil,
            expiresAt: expiresAt,
            accessMode: accessMode,
            editorEmails: [],
            createdAt: "2026-09-25T02:11:00.000Z"
        )
    }

    // MARK: - 回收站

    @Test func trashSubtitleCarriesOriginalPathAndTime() {
        // 具体哪一天跟着本机日历走（`DriveText.date` 就是这么算的），所以右边拿同一个函数
        // 算出来的那一份来对，不钉死一句话。
        #expect(
            DriveTrashRow.subtitle(for: entry("旧版首页.png"))
                == "设计稿/旧版首页.png · " + DriveText.date(movedAt)
        )
    }

    @Test func trashWithoutAPathKeepsOnlyTheTime() {
        // 服务端的 `originalPath` 是可选的：缺了那一段就少那一段，不留一个吊在末尾的「 · 」。
        let subtitle = DriveTrashRow.subtitle(for: entry("草稿", originalPath: nil))
        #expect(subtitle == DriveText.date(movedAt))
        #expect(!subtitle.contains("·"))
        // 只有空白也不算一段。
        #expect(
            DriveTrashRow.subtitle(for: entry("草稿", originalPath: "  "))
                == DriveText.date(movedAt)
        )
    }

    @Test func trashWithoutEitherSideIsADash() {
        // 两边都读不出来时说「—」，与列表里其它读不出来的值同一种说法；空白副标题会让
        // 那一行只剩一个名字。
        #expect(
            DriveTrashRow.subtitle(for: entry("草稿", originalPath: nil, trashedAt: "不是时间"))
                == "—"
        )
    }

    @Test func trashSubtitleDoesNotGuessTheKind() {
        // 普通项与公开素材共用这一份副标题：条目自己那两条（`isPublicAsset` 决定恢复走哪条
        // 接口）不该漏到屏幕上 —— 用户看的是「它会回到哪去」，不是服务端内部怎么分类。
        let normal = DriveTrashRow.subtitle(for: entry("旧版首页.png"))
        let publicAsset = DriveTrashRow.subtitle(
            for: entry("头像-旧.png", originalPath: "设计稿/旧版首页.png", publicAsset: true)
        )
        #expect(normal == publicAsset)
    }

    // MARK: - 公开素材

    @Test func assetSubtitleCarriesVisitsAndLastAccess() {
        #expect(
            DrivePublicAssetRow.subtitle(for: asset("分享头图.png"))
                == "访问 42 次 · " + DriveText.date("2026-09-25T08:12:00.000Z")
        )
    }

    @Test func neverAccessedAssetKeepsOnlyTheCount() {
        // 从没被访问过时服务端不给 `lastAccessedAt`：只留前半段，不留一个吊着的「 · 」。
        let subtitle = DrivePublicAssetRow.subtitle(for: asset("使用手册.pdf", accessCount: "0", lastAccessedAt: nil))
        #expect(subtitle == "访问 0 次")
        #expect(!subtitle.contains("·"))
    }

    @Test func unreadableCountIsZeroNotMissing() {
        // 与 `DriveText.bytes` 同一条兜底：读不出来按 0 算，屏幕上那一格宁可说「访问 0 次」。
        #expect(
            DrivePublicAssetRow.subtitle(
                for: asset("a.pdf", accessCount: "99999999999999999999999", lastAccessedAt: nil)
            ) == "访问 0 次"
        )
        // 时间戳读不出来时也只留前半段：`DriveText.date` 给的是空串。
        #expect(
            DrivePublicAssetRow.subtitle(
                for: asset("a.pdf", accessCount: "3", lastAccessedAt: "不是时间")
            ) == "访问 3 次"
        )
    }

    // MARK: - 分享管理

    @Test func shareSubtitleCarriesModeAndExpiry() {
        #expect(DriveShareRow.subtitle(for: share()) == "仅阅读 · 永久有效")
        #expect(
            DriveShareRow.subtitle(for: share(accessMode: .linkEdit))
                == "登录后可编辑 · 永久有效"
        )
        #expect(
            DriveShareRow.subtitle(for: share(accessMode: .specifiedUsersEdit))
                == "指定邮箱可编辑 · 永久有效"
        )
        // 有到期时刻时按它说，说法与分享结果页逐字相同。
        #expect(
            DriveShareRow.subtitle(for: share(expiresAt: "2030-01-01T00:00:00.000Z"))
                == "仅阅读 · 有效期至 " + DriveText.date("2030-01-01T00:00:00.000Z")
        )
    }

    @Test func passwordIsSaidOnlyWhenThereIsOne() {
        // 密码那一段是有才说：没有的东西不该占一段。
        #expect(DriveShareRow.subtitle(for: share(passwordEnabled: false)) == "仅阅读 · 永久有效")
        #expect(
            DriveShareRow.subtitle(for: share(passwordEnabled: true))
                == "仅阅读 · 永久有效 · 有密码"
        )
    }

    @Test func aDeletedSourceIsSaidOnTheRow() {
        // 链接打开是空的，而这一行是用户点开它之前唯一能看到的东西。
        #expect(
            DriveShareRow.subtitle(for: share(sourceDeleted: true))
                == "仅阅读 · 永久有效 · 来源已删除"
        )
        // 四段一起在时顺序固定：权限 · 有效期 · 有密码 · 来源已删除。
        #expect(
            DriveShareRow.subtitle(
                for: share(passwordEnabled: true, expiresAt: "2030-01-01T00:00:00.000Z", sourceDeleted: true)
            )
                == "仅阅读 · 有效期至 " + DriveText.date("2030-01-01T00:00:00.000Z") + " · 有密码 · 来源已删除"
        )
    }
}
