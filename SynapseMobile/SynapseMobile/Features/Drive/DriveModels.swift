import Foundation

/// 云盘服务端 DTO 的一个子集。
///
/// 字段名与服务端 JSON **逐字相同**：`APIClient` 用的是裸 `JSONDecoder()`，没有配
/// `keyDecodingStrategy`（见 `APIClient.decode`），所以这里不能指望 snake_case 转换。
/// 只声明手机端真正要用的字段——服务端多给的键解码器会自己忽略，少给一个必需字段
/// 才会让整页读不出来。
///
/// 全部类型都是只读的：手机端不往这些结构里写派生状态，派生展示一律走 `DriveText`。

// MARK: - 枚举

/// 一项是文件还是文件夹。
enum DriveItemKind: String, Codable, Hashable {
    case file
    case folder

    /// 服务端目前只发这两个值。认不出来的一律当文件：文件夹要能下钻，只有当它确实是
    /// 文件夹时才成立，猜错的代价比「点不开」大。
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = DriveItemKind(rawValue: raw) ?? .file
    }
}

/// 服务端给这一项安排的预览方式，预览页按它分流（Spec §4.4）。
enum DrivePreviewKind: String, Codable, Hashable {
    case image
    case text
    case markdown
    /// 服务端的原始值带连字符，必须逐字对上。
    case htmlSource = "html-source"
    case downloadOnly = "download-only"

    /// 认不出来的种类按「不能预览」处理：把字节交给 QuickLook，或者直接说这个格式
    /// 打不开。猜成文本去读，读出来的是别的东西。
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = DrivePreviewKind(rawValue: raw) ?? .downloadOnly
    }
}

/// 一条分享对访问者的权限（Spec §4.5）。
///
/// 既是响应里的字段，也是创建分享时的请求值，所以两个方向都要能编解码。
enum DriveAccessMode: String, Codable, Hashable {
    case linkRead = "link_read"
    case linkEdit = "link_edit"
    case specifiedUsersEdit = "specified_users_edit"

    /// 认不出来时按「仅阅读」显示：权限上说得保守一点，总好过替服务端许下一个它没
    /// 承诺的权限。
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = DriveAccessMode(rawValue: raw) ?? .linkRead
    }
}

/// 分享的有效期（Spec §4.5）。
///
/// 只用来拼创建分享的请求，客户端不自己算到期时刻——`expiresAt` 由服务端给。
/// `allCases` 的顺序就是表单里那五个选项的顺序。
enum DriveExpiry: String, Codable, CaseIterable, Hashable {
    case threeDays = "3d"
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case oneYear = "1y"
    case forever
}

// MARK: - 浏览

/// 列表里的一行，也是快照的 `current`。
struct DriveBrowserItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let type: DriveItemKind
    /// 服务端的大整数，DTO 里就是字符串（Spec §7.3）。要算数就转 `Int64`，别转 `Int`。
    let size: String
    let mimeType: String?
    let updatedAt: String
    let previewKind: DrivePreviewKind
    let browserUrl: String
    /// 文件夹没有这条；根也没有。
    let downloadUrl: String?
    /// 有活跃分享时才有值，行尾据此画那个 `link` 符号（Spec §4.3）。
    let shareUrl: String?

    var isFolder: Bool { type == .folder }

    /// 根是服务端合成的（`server/src/drive/drive-browser.ts`），不是一个真文件夹，
    /// 名字也是服务端那边的「网盘」。手机端按这个认根，标题用自己的说法。
    var isRoot: Bool { id == "root" }

    /// 字节数。读不出来就是 nil，界面显示「—」而不是把一个大文件读成 0 字节。
    var sizeBytes: Int64? { Int64(size) }
}

/// 面包屑的一级。服务端给的第一项是那条合成的根。
struct DriveBreadcrumb: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let browserUrl: String

    var isRoot: Bool { id == "root" }
}

/// 列表的分页游标。每页 50 项，`hasMore` 为真时用 `nextOffset` 续页。
struct DriveChildrenPage: Decodable, Hashable {
    let offset: Int
    let limit: Int
    let hasMore: Bool
    let nextOffset: Int?
}

/// 一层文件夹的完整快照。
struct DriveBrowserSnapshot: Decodable, Hashable {
    let current: DriveBrowserItem
    let breadcrumbs: [DriveBreadcrumb]
    let children: [DriveBrowserItem]
    /// 旧服务端可能不给分页块；缺了就当这一层没有下一页。
    let childrenPage: DriveChildrenPage?
    let preview: DrivePreview?
    let canDownload: Bool
    /// 文件夹能不能打包下载（服务端自己压成 zip）。
    let canZip: Bool

    var isRoot: Bool { current.isRoot }
}

/// 一项的预览内容。按 `kind` 决定哪几个字段有值。
struct DrivePreview: Decodable, Hashable {
    let kind: DrivePreviewKind
    let text: String?
    let html: String?
    /// 文本超过服务端一次能给的上限时为真，界面要说清只显示了开头。
    let truncated: Bool
    let imageUrl: String?
    let visitUrl: String?
}

/// 文本文件的检查结果：拿版本号去分段读（Spec §4.4）。
///
/// `kind` 与 `DrivePreviewKind` 用的是同一套取值（`markdown` / `text` / `html-source`），
/// 所以预览页两个地方可以合着判断。
struct DriveContentInspect: Decodable, Hashable {
    let itemId: String
    let name: String
    let kind: DrivePreviewKind
    let sizeBytes: Int
    let versionId: String
    let editable: Bool
}

/// 文本文件的一段。`nextCursor` 为 nil 或者 `endOfFile` 为真就到头了。
struct DriveContentChunk: Decodable, Hashable {
    let itemId: String
    let versionId: String
    let text: String
    let startByte: Int
    let endByte: Int
    let totalBytes: Int
    let nextCursor: String?
    let endOfFile: Bool
}

// MARK: - 回收站

/// 回收站里的一条。普通项与公开素材共用这份列表，恢复走的是两条接口。
struct DriveTrashEntry: Decodable, Identifiable, Hashable {
    let id: String
    /// 服务端的取值只有 `normal` 与 `public_asset`，行为差别只有「恢复调哪条接口」
    /// 一处，所以留字符串 + 一个可读的判据，不额外立一个枚举。
    let kind: String
    let name: String
    let type: DriveItemKind
    let size: String
    let mimeType: String?
    /// 恢复要知道它会回到哪去（Spec §4.6），所以原路径要显示出来。
    let originalPath: String?
    /// 只有公开素材的条目才有。
    let assetId: String?
    let trashedAt: String

    var isFolder: Bool { type == .folder }
    var isPublicAsset: Bool { kind == "public_asset" }
    var sizeBytes: Int64? { Int64(size) }
}

struct DriveTrashPage: Decodable, Hashable {
    let items: [DriveTrashEntry]
    let total: Int
    let page: DriveChildrenPage
}

// MARK: - 分享

/// 创建分享的结果（也用于查看单条分享）。
struct DriveShare: Decodable, Identifiable, Hashable {
    let id: String
    let shareId: String
    let itemId: String
    let enabled: Bool
    let url: String
    let urlWithPassword: String
    let passwordEnabled: Bool
    /// 密码只在这张结果页上出现，别写进日志。
    let password: String?
    let expiresAt: String?
    let accessMode: DriveAccessMode
    let editorEmails: [String]
    let createdAt: String
}

/// 分享列表里的一行：比创建结果多了来源的名字与状态。
struct DriveShareListItem: Decodable, Identifiable, Hashable {
    let id: String
    let shareId: String
    let itemId: String
    let itemName: String
    let itemType: DriveItemKind
    /// 来源已经被删掉：链接还在，但点进去是空的，要提前说。
    let sourceDeleted: Bool
    let url: String
    let urlWithPassword: String
    let passwordEnabled: Bool
    let password: String?
    let expiresAt: String?
    let accessMode: DriveAccessMode
    let editorEmails: [String]
    let createdAt: String
}

/// 分享列表的一页。服务端不给总数，靠 `page.hasMore` 续页。
struct DriveSharePage: Decodable, Hashable {
    let items: [DriveShareListItem]
    let page: DriveChildrenPage
}

// MARK: - 用量

struct DriveUsage: Decodable, Hashable {
    let usedBytes: String
    let reservedBytes: String
    let quotaBytes: String

    var used: Int64? { Int64(usedBytes) }
    var quota: Int64? { Int64(quotaBytes) }
}

// MARK: - 公开素材

/// 一条直链。公开素材是平铺的，没有文件夹，重名是允许的。
struct DrivePublicAsset: Decodable, Identifiable, Hashable {
    let assetId: String
    let itemId: String
    let name: String
    let size: String
    let mimeType: String
    let url: String
    let lifecycleStatus: String
    let accessCount: String
    let responseBytes: String
    let lastAccessedAt: String?
    let createdAt: String
    let updatedAt: String

    /// 列表按 `assetId` 认这一行：`itemId` 会随删除重建而变。
    var id: String { assetId }
    var sizeBytes: Int64? { Int64(size) }
}

struct DrivePublicAssetPage: Decodable, Hashable {
    let items: [DrivePublicAsset]
    let total: Int
    let page: DriveChildrenPage
}

// MARK: - 上传

/// prepare 时发现目标位置已经有一个同名文件。
///
/// 旧服务端整个字段都不返回，那种情况下调用方按「未知」处理，不弹确认（Spec §7.3）。
struct DriveUploadOverwriteTarget: Decodable, Hashable {
    let itemId: String
    let name: String
    let currentVersionId: String?
    /// 目标是 Markdown 或纯文本：这种文件人随时可能正在编辑器里改它，覆盖要说一声。
    /// 独立的 HTML 不算——用重新生成的页面盖掉它是本来就想做的事。
    let documentText: Bool
}
