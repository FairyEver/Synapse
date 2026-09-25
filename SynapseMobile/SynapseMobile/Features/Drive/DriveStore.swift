import Foundation
import Observation
import os

// MARK: - 排序

/// 列表按什么排。四个键就是 Spec §2.1 表里那四个，`rawValue` 是落盘用的值。
enum DriveSortKey: String, CaseIterable, Hashable {
    case name
    case date
    case size
    case kind

    /// 排序菜单与列表副标题共用的说法。
    var label: String {
        switch self {
        case .name: return "名称"
        case .date: return "日期"
        case .size: return "大小"
        case .kind: return "种类"
        }
    }
}

/// 一层列表的排序。
///
/// 纯函数：偏好（哪个键、升还是降）由 `DriveStore` 读了当参数传进来，这一层**不碰**
/// `UserDefaults`。不是洁癖——本仓已经有断言因为读一个会被并行套件改写的键而飘掉，
/// 排序这里不读它，测试才是密闭的。
enum DriveSort {
    /// 排好序的一份列表：文件夹永远在前，然后按 `key` 排。
    static func sorted(
        _ items: [DriveBrowserItem],
        by key: DriveSortKey,
        ascending: Bool
    ) -> [DriveBrowserItem] {
        items.sorted { lhs, rhs in
            // 升降序说的是同一组里怎么排，不改变「文件夹在前」这一条（Spec §2.1）。
            if lhs.isFolder != rhs.isFolder { return lhs.isFolder }

            let result = compare(lhs, rhs, by: key)
            if result != .orderedSame {
                return ascending ? result == .orderedAscending : result == .orderedDescending
            }
            // 同值的项本来没有确定顺序（Swift 的排序不保证稳定），而每一层都是重取的：
            // 不兜一条，同一份列表两次进来可能换个样子。按名称兜，方向跟着当前排序走。
            let byName = lhs.name.localizedStandardCompare(rhs.name)
            if byName == .orderedSame { return false }
            return ascending ? byName == .orderedAscending : byName == .orderedDescending
        }
    }

    private static func compare(
        _ lhs: DriveBrowserItem,
        _ rhs: DriveBrowserItem,
        by key: DriveSortKey
    ) -> ComparisonResult {
        switch key {
        case .name:
            // `localizedStandardCompare` 把数字当数字比：「第 2 章」排在「第 10 章」前面。
            // 逐字符比的话「1」会小于「2」，正好反过来。
            return lhs.name.localizedStandardCompare(rhs.name)
        case .date:
            return compare(timestamp(lhs), timestamp(rhs))
        case .size:
            // 读不出大小的按 0 算：与 `DriveText.bytes` 是同一套兜底，那一格显示的就是
            // 「0 字节」，排序里也不该让它忽大忽小。
            return compare(lhs.sizeBytes ?? 0, rhs.sizeBytes ?? 0)
        case .kind:
            // 「种类」是图标上那个种类（Spec §4.3 那张表），不是服务端的 `previewKind`。
            return compare(rank(DriveText.kind(of: lhs.name)), rank(DriveText.kind(of: rhs.name)))
        }
    }

    /// 服务端时间戳读不出来时按最早算：`updatedAt` 是每一层都有的字段，真读不出来是
    /// 自己这边认不得它的格式，排在最后比乱插在中间好。
    private static func timestamp(_ item: DriveBrowserItem) -> Date {
        ISO8601DateFormatter.parseWireTimestamp(item.updatedAt) ?? .distantPast
    }

    private static func compare<T: Comparable>(_ lhs: T, _ rhs: T) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }

    /// 种类的先后：Spec §4.3 那张表的行序，认不出来的一律最后。
    private static func rank(_ kind: DriveFileKind) -> Int {
        switch kind {
        case .pdf: return 0
        case .image: return 1
        case .video: return 2
        case .audio: return 3
        case .archive: return 4
        case .document: return 5
        case .spreadsheet: return 6
        case .presentation: return 7
        case .code: return 8
        case .unknown: return 9
        }
    }
}

// MARK: - 批量结果

/// 一批动作的结果。
///
/// 服务端没有批量接口，多选的移动 / 删除是**逐项**调用单条接口的（Spec §5.2），所以
/// 这里要能分开说「几项成了、哪几项没成、为什么」。不做「全部成功才生效」的原子语义：
/// 那个语义在客户端根本兑现不了——已经删掉的那几项不会因为后面一项失败而回来，而一次
/// 网络抖动会让二十次已经生效的操作全部白做。
struct DriveBatchOutcome: Equatable {
    /// 一项为什么没成。`name` 是用户看得到的那一行，`reason` 是给用户看的一句话。
    struct Failure: Equatable, Hashable {
        let name: String
        let reason: String
    }

    let succeeded: Int
    let failures: [Failure]

    var failed: Int { failures.count }
    var total: Int { succeeded + failures.count }

    /// 一项都没做（没选中任何项）。这种批次不该弹提示：按钮在没选中时本来就是置灰的。
    var isEmpty: Bool { total == 0 }
    var isComplete: Bool { !isEmpty && failures.isEmpty }

    /// 「3 项删除成功，1 项失败」——Spec §5.2 里 notice 上那一句。
    func summary(_ action: String) -> String {
        if isEmpty { return "没有可\(action)的项目。" }
        if failures.isEmpty { return "\(succeeded) 项\(action)成功" }
        if succeeded == 0 { return "\(failed) 项\(action)失败" }
        return "\(succeeded) 项\(action)成功，\(failed) 项失败"
    }

    /// 失败项的「名字 + 原因」，全成功时是 nil。
    ///
    /// 汇总那一句只报数量，点名要靠这一条：多选时用户盯着的是列表，不点名就不知道
    /// 留下的那一项是哪一个。
    var failureSentence: String? {
        guard !failures.isEmpty else { return nil }
        return failures.map { "「\($0.name)」\($0.reason)" }.joined(separator: "；")
    }

    /// 逐项跑一遍，把成败收成一份汇总。
    ///
    /// 「一项失败不影响后面几项」这条语义就在这个循环里，所以它是值类型自己的方法，
    /// 而不是某个 store 方法里的一段 `for`：散在调用点就只剩「都调了一遍」可看，而
    /// 「失败也要继续往下做」正是 Spec §5.2 要的那条。动作本身是网络调用，但这一层
    /// 只认「成了」与「失败原因」——于是它可以被单测直接驱动，不必起一个 App。
    ///
    /// `@MainActor` 是为了让传进来的闭包在调用者的隔离域里跑：它要读 store 的路径栈
    /// （判断这次移动合不合法），那些状态都在主线程上。
    @MainActor
    static func collecting<T>(
        _ items: [T],
        perform: (T) async -> Failure?
    ) async -> DriveBatchOutcome {
        var succeeded = 0
        var failures: [Failure] = []
        for item in items {
            if let failure = await perform(item) {
                failures.append(failure)
            } else {
                succeeded += 1
            }
        }
        return DriveBatchOutcome(succeeded: succeeded, failures: failures)
    }
}

// MARK: - 路径栈

/// 路径栈与面包屑的纯计算。
///
/// `path` 从根往下一级一级存**文件夹**，根层是空数组：服务端那条合成的根
/// （`id == "root"`、名字叫「网盘」）不是一层真实文件夹，手机端的根标题用自己的说法，
/// 所以它不进栈（Spec §4.2）。
enum DrivePath {
    /// 服务端那条合成根的 id。与 `DriveBrowserItem.isRoot` / `DriveBreadcrumb.isRoot`
    /// 判的是同一个值。
    static let rootId = "root"

    /// 把文件夹移进它自己的子孙时给用户的那句话。
    ///
    /// 本地就判得出来（`canMove`），所以不必等服务端拒一次再转述它的话——而且它那句
    /// 说的是「无效的父级」这类话，不如这一句具体。
    static let intoOwnDescendantReason = "不能把文件夹移到它自己或它的子文件夹里。"

    /// 面包屑。第 0 项永远是手机端自己的「云盘」，后面每一级对应路径栈里的一项。
    ///
    /// 服务端那份面包屑的第一项是它合成的根（名字是「网盘」），丢掉；其余从路径栈取，
    /// 不从服务端那份取——改名之后栈里那个名字是新的，而快照里那份面包屑是这次请求
    /// 那一刻的。跳转本身也不需要服务端那份：走的是路径栈。
    static func breadcrumbs(server: [DriveBreadcrumb], path: [DriveBrowserItem]) -> [DriveBreadcrumb] {
        let serverRoot = server.first { $0.isRoot }
        var trail = [DriveBreadcrumb(
            id: rootId,
            name: DriveText.rootTitle,
            // 手机端不用它取数据，它只是跟着 id 一起带着的东西；服务端没给就是空串。
            browserUrl: serverRoot?.browserUrl ?? ""
        )]
        trail.append(contentsOf: path.map {
            DriveBreadcrumb(id: $0.id, name: $0.name, browserUrl: $0.browserUrl)
        })
        return trail
    }

    /// 下钻一级。
    ///
    /// 文件进不了栈：点开一个文件是预览，它不改变「现在在哪一层」。根同理——它不进栈。
    static func pushing(_ item: DriveBrowserItem, onto path: [DriveBrowserItem]) -> [DriveBrowserItem] {
        guard item.isFolder, !item.isRoot else { return path }
        return path + [item]
    }

    /// 回上一级；已经在根层就原样返回。
    static func popping(_ path: [DriveBrowserItem]) -> [DriveBrowserItem] {
        path.isEmpty ? path : Array(path.dropLast())
    }

    /// 面包屑点第 `depth` 级之后该在哪。
    ///
    /// 第 0 项是「云盘」，第 n 项对应栈里第 n-1 个文件夹：点第 n 项就是留在那一层，
    /// 栈截到 n 个。
    static func truncated(_ path: [DriveBrowserItem], toDepth depth: Int) -> [DriveBrowserItem] {
        Array(path.prefix(max(0, min(depth, path.count))))
    }

    /// 把 `itemId` 移到 `targetId` 下合不合法。`targetId` 为 nil 是移到根。
    ///
    /// 只在**本地已知的那一段路径**上判：`itemId` 出现在栈里时，它后面每一级（一直到
    /// 当前这一层）都是它的子孙，拿它们当目标就是把文件夹塞进自己里面。目标不在栈上时
    /// 本地无从判断，放行交给服务端——它有自己的环检测，而这里多拦一步只会把合法操作
    /// 挡下来。
    static func canMove(itemId: String, into targetId: String?, path: [DriveBrowserItem]) -> Bool {
        guard let targetId else { return true }
        if targetId == itemId { return false }
        guard let origin = path.firstIndex(where: { $0.id == itemId }) else { return true }
        return !path[(origin + 1)...].contains { $0.id == targetId }
    }
}

// MARK: - 回收站

/// 一条回收站条目恢复时该走哪条接口。
///
/// 服务端把两种条目放在同一份列表里（条目自己的 `kind`），恢复却是两条路：普通项走
/// `/drive/items/:id/restore`，公开素材走 `/drive/public-assets/:assetId/restore`。
/// 分流放在这里而不是每个调用点：挑错的后果是「看着恢复了、其实没有」——这两条路走错的
/// 表现都是 404，和「服务端没有这个能力」长得一样。
enum DriveTrashRestore: Equatable {
    /// 普通项。`itemId` 就是条目自己的 `id`：列表里那一行本来就是一条 `DriveItem`。
    case item(itemId: String)
    case publicAsset(assetId: String)

    /// 这一条恢复不了时给用户的那句话。
    ///
    /// 只在服务端说它是公开素材、却没给 `assetId`（DTO 里那个字段是可选的）时才会用到。
    static let unresolvedReason = "这一项暂时无法恢复，请稍后重试。"

    /// 条目 → 该调的接口；`nil` 表示这一条恢复不了。
    static func target(for entry: DriveTrashEntry) -> DriveTrashRestore? {
        guard entry.isPublicAsset else { return .item(itemId: entry.id) }
        // 拿条目 id 去走公开素材那条路只会得到 404，本地拼不出正确的路径时不如直说。
        guard let assetId = entry.assetId, !assetId.isEmpty else { return nil }
        return .publicAsset(assetId: assetId)
    }
}

// MARK: - 分享

/// 分享表单里的四项。
///
/// 服务端把请求里的设置**叠在**已有那条分享之上（`drive.service.ts` 的
/// `resolveShareAccessSettingsBase`）：没发过去的键保持原样。所以只有用户真的动过的那些
/// 才该发出去——把没动过的也发一遍，密码那一项会被重算一次，于是「带密码的链接」换了
/// 一个地址，而用户什么都没改。
///
/// `defaults` 是 Spec §4.5 里表单打开时的样子，逐项与服务端自己的默认值
/// （`DRIVE_DEFAULT_ACCESS_SETTINGS`）相同，所以新分享的「动过」是相对同一套值比的。
struct DriveShareForm: Equatable {
    var expiry: DriveExpiry
    var passwordEnabled: Bool
    var accessMode: DriveAccessMode
    var editorEmails: [String]

    static let defaults = DriveShareForm(
        expiry: .forever,
        passwordEnabled: false,
        accessMode: .linkRead,
        editorEmails: []
    )

    /// 相对 `initial` 动过的那些 → 请求体。
    ///
    /// 一个都没动时回来的是**空体**，而服务端把空体当成「没给设置」
    /// （`parseAccessSettings` 把空对象当 `undefined`）——正好是「复用已有那条，别动它的
    /// 设置」。
    ///
    /// `initial` 是参数而不是写死 `defaults`：表单打开时该按这一项**当前**的样子填
    /// （已有的那一条带着密码与有效期），否则用户什么都没改，发出去的却是「把密码关掉」。
    func settings(changedFrom initial: DriveShareForm) -> APIClient.DriveShareSettings {
        var settings = APIClient.DriveShareSettings()
        if expiry != initial.expiry { settings.expiresIn = expiry }
        if passwordEnabled != initial.passwordEnabled { settings.passwordEnabled = passwordEnabled }
        if accessMode != initial.accessMode { settings.accessMode = accessMode }
        // 邮箱只在「指定邮箱可编辑」这一档有意义：别的档位上服务端会把它清空
        // （`normalizeDriveAccessSettings`），发过去只是白搭。反过来，选中那一档却带着空
        // 名单会被服务端拒（「请至少添加一个可编辑用户。」），所以表单在那一档上不该允许
        // 空名单提交。
        if accessMode == .specifiedUsersEdit, editorEmails != initial.editorEmails {
            settings.editorEmails = editorEmails
        }
        return settings
    }
}

extension APIClient.DriveShareSettings {
    /// 一个字段都没有。
    ///
    /// 空体与服务端嘴里的「没给设置」是一回事（见 `DriveShareForm.settings(changedFrom:)`），
    /// 所以本机也就没有理由为它多打一次请求。
    var isEmpty: Bool {
        passwordEnabled == nil && expiresIn == nil && accessMode == nil && editorEmails == nil
    }
}

extension DriveShare {
    /// 分享列表里那一条 → 结果页要的形状。
    ///
    /// `enabled` 一律为真：服务端的分享列表只给还活着的那几条（`enabled: true` 且没过期），
    /// 所以列表里出现的就是能用的。
    init(listItem: DriveShareListItem) {
        self.init(
            id: listItem.id,
            shareId: listItem.shareId,
            itemId: listItem.itemId,
            enabled: true,
            url: listItem.url,
            urlWithPassword: listItem.urlWithPassword,
            passwordEnabled: listItem.passwordEnabled,
            password: listItem.password,
            expiresAt: listItem.expiresAt,
            accessMode: listItem.accessMode,
            editorEmails: listItem.editorEmails,
            createdAt: listItem.createdAt
        )
    }
}

/// 这一次分享要怎么做。
///
/// 「已有活跃分享时不重复创建」就落在这里：本机手里有那一条（分享列表里那一条带着链接、
/// 带密码链接与密码）**而且用户什么都没改**时，连请求都不必发——服务端那条只会在不带
/// 设置去的时候复用它（`drive.service.ts` 的 `reusedExisting`），而带设置去就是把它更新
/// 掉，那种情况本机说不出结果，只能走一次请求。
enum DriveSharePlan {
    /// 用本机已经知道的那一条，不发请求。
    case useExisting(DriveShare)
    /// 发一次请求。带设置是更新，空体是让服务端复用或新建。
    case request(APIClient.DriveShareSettings)

    static func of(
        itemId: String,
        known: [DriveShareListItem],
        settings: APIClient.DriveShareSettings
    ) -> DriveSharePlan {
        if settings.isEmpty, let existing = existing(forItemId: itemId, in: known) {
            return .useExisting(existing)
        }
        return .request(settings)
    }

    /// 这一项已有的那一条活跃分享（本机知道的话）。
    ///
    /// 比的是 `itemId`：`id` 与 `shareId` 是分享自己的两个编号，与项无关。服务端对同一项
    /// 只留一条活跃分享，所以取第一条就够。
    static func existing(forItemId itemId: String, in known: [DriveShareListItem]) -> DriveShare? {
        known.first { $0.itemId == itemId }.map(DriveShare.init(listItem:))
    }
}

/// 分享一项的结果。
///
/// 三态而不是一个 `DriveShare?`：结果页上有一句话只在复用的时候出现（「链接未变」，
/// Spec §4.5），而失败要能带上服务端给的那句话——两种都装不进 `nil` 里。
enum DriveShareOutcome {
    /// 这一项本来没有分享，这次新建了一条。
    case created(DriveShare)
    /// 本来就有那一条，链接没变。
    case reused(DriveShare)
    /// 没成。`reason` 是给用户看的一句话。
    case failed(reason: String)

    /// 成了的话，结果页要的那一条。
    var share: DriveShare? {
        switch self {
        case .created(let share), .reused(let share): return share
        case .failed: return nil
        }
    }
}

// MARK: - 公开素材的直链

/// 公开素材的直链。
///
/// 服务端在 `DrivePublicAsset.url` 里给的就是这一条（`buildDrivePublicAssetUrl`），它按
/// 产品的公开站点地址（`APP_PUBLIC_URL`）拼，是权威的那一条。这里拼的是**兜底**：旧服务端
/// 不给 `url` 时，本机按自己连的源站拼一条，总好过让「拷贝直链」拷到空串。
enum DrivePublicAssetLink {
    /// 服务端那条路由：`drive.controller.ts` 的 `@Get("/files/:assetId")`。
    static let pathPrefix = "/files"

    /// `{origin}/files/{assetId}`。
    ///
    /// `origin` 是参数而不是在这里读 `AppConfiguration`：与 `DriveRoute.download` 同一个
    /// 理由——那个键会被并行测试改写，纯函数不去读它，断言才是密闭的。
    static func url(assetId: String, origin: URL) -> String {
        origin.absoluteString + pathPrefix + "/" + escaped(assetId)
    }

    /// 一条素材给用户的那条直链。
    static func directLink(for asset: DrivePublicAsset, origin: URL) -> String {
        let given = asset.url.trimmingCharacters(in: .whitespacesAndNewlines)
        return given.isEmpty ? url(assetId: asset.assetId, origin: origin) : given
    }

    /// 路径段里的编码：与 `DriveRoute` 里那一句同一条规则。
    private static func escaped(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}

// MARK: - 搜索词

/// 搜索词的归一。
///
/// 空串、纯空白与 `nil` 都是「没有搜索词」：`?search=` 是白拼一个参数（服务端自己也会把
/// 它当成没给），而本机「这一份列表是搜什么搜出来的」也会因此多出两种写法——恢复一条
/// 之后那次重取就可能带着一个空搜索词去。
enum DriveSearchTerm {
    static func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }
}

// MARK: - Store

/// 云盘的浏览状态与文件夹操作。
///
/// 手机端直连服务端，**不缓存**：一层的内容是现取的。文件的所在、名字、分享状态都是
/// 电脑或网页随时会改的东西，本机留一份副本只会显示过期的东西——而这是文件管理，
/// 显示一个不存在了的名字比多转半秒更糟。
///
/// 网络方法收 `using client: APIClient`，与 `MeetingStore` 同形：不造协议、不为它写单测。
/// 真正会算错的东西（排序、批量结果、路径栈）都在上面那些纯函数里，`DriveStoreTests`
/// 测的是它们。
@MainActor
@Observable
final class DriveStore {
    /// 从根到当前文件夹。根层是空的：服务端那条合成的根不是一层真实文件夹。
    private(set) var path: [DriveBrowserItem] = []
    /// 当前这一层的快照。
    private(set) var current: DriveBrowserSnapshot?
    private(set) var loading = false
    /// 续页单独一个标志。
    ///
    /// 不能复用 `loading`：那个一置上，列表就得进加载态，而续页时列表里已经有几十行
    /// 在显示，把它们擦成占位是最没必要的一种闪。
    private(set) var loadingMore = false
    private(set) var errorMessage: String?

    /// 层代次：一层被换掉（下钻、返回、跳转、刷新落地）或者被清空（退出登录）就 +1。
    ///
    /// 每个请求取的都是「出发时那一层」的数据，而 `await` 回来时用户可能已经去了别处：
    /// 滚到底触发的续页还没回来，人就点进了另一个文件夹。这一页要是不管不顾地接上去，
    /// 标题与面包屑（来自 `path`）说 B、列表显示 A——而且比看着别扭更糟的是 `folderId`
    /// 这时解析成 A，接着的新建、改名、移动、删除会全落在**另一个文件夹**上。
    ///
    /// 与 `PathIntent` 是同一条标准：`await` 之后才准落地，落地前先确认说的还是同一层。
    private var layerGeneration = 0

    // MARK: 账号级的那几屏

    /// 回收站。
    private(set) var trash: [DriveTrashEntry] = []
    /// 回收站里一共有多少条。列表末尾那一行「回收站」的副标题「N 项」用它：列表是分页的，
    /// 而这一页的条数说明不了总数。
    private(set) var trashTotal = 0
    private(set) var trashLoading = false
    private(set) var trashErrorMessage: String?

    private(set) var shares: [DriveShareListItem] = []
    private(set) var sharesLoading = false
    private(set) var sharesErrorMessage: String?

    private(set) var assets: [DrivePublicAsset] = []
    private(set) var assetsLoading = false
    private(set) var assetsErrorMessage: String?

    /// 用量。拉不到时是 `nil`，列表最底下那一行这次不显示。
    private(set) var usage: DriveUsage?

    /// 现在这一份回收站是搜什么搜出来的。恢复一条之后要带着同一个词重取，否则用户恢复
    /// 一项，搜索结果就被整个重置成「全部」了。
    private var trashSearch: String?

    /// 账号代次：退出登录时 +1。
    ///
    /// 回收站 / 分享 / 公开素材 / 用量都不是「一层」，它们的失效条件只有「换了个账号」这一
    /// 条，所以不跟 `layerGeneration` 共用——那个每下一层文件夹就 +1，会让一次正在飞的
    /// 回收站查询被一次无关的导航作废。
    private var accountGeneration = 0

    /// 本地视图偏好（Spec §2.3）：服务端不接受排序参数，排序发生在已加载的这一段上。
    private(set) var sortKey: DriveSortKey
    private(set) var sortAscending: Bool

    private static let sortKeyDefaultsKey = "SynapseDriveSortKey"
    private static let sortAscendingDefaultsKey = "SynapseDriveSortAscending"

    init() {
        let defaults = UserDefaults.standard
        sortKey = defaults.string(forKey: Self.sortKeyDefaultsKey)
            .flatMap(DriveSortKey.init(rawValue:)) ?? .name
        // 键不存在时 `bool(forKey:)` 也是 false，与「用户选了降序」分不开，所以先看这个键
        // 在不在：默认是升序。
        sortAscending = defaults.object(forKey: Self.sortAscendingDefaultsKey) == nil
            ? true
            : defaults.bool(forKey: Self.sortAscendingDefaultsKey)
    }

    // MARK: - 派生

    /// 当前这一层排好序的子项。
    var visibleChildren: [DriveBrowserItem] {
        DriveSort.sorted(current?.children ?? [], by: sortKey, ascending: sortAscending)
    }

    /// 大标题：根层是「云盘」，下钻之后是当前文件夹名。
    var title: String {
        path.last?.name ?? DriveText.rootTitle
    }

    /// 面包屑。第 0 项是「云盘」。
    var breadcrumbs: [DriveBreadcrumb] {
        DrivePath.breadcrumbs(server: current?.breadcrumbs ?? [], path: path)
    }

    /// 当前这一层的文件夹 id；根层是 nil。
    ///
    /// 根要发 `null`：服务端把根当成「没有父级」，而 `"root"` 在它那边是一个要去库里
    /// 找的真实文件夹（`drive.service.ts` 的 `requireOwnedFolder`），拿它当父级会被判成
    /// 「这一项不在你的云盘里」。
    var folderId: String? {
        guard let current, !current.isRoot else { return nil }
        return current.current.id
    }

    var hasMore: Bool { current?.childrenPage?.hasMore == true }

    // MARK: - 排序偏好

    /// 换排序键。方向不动：用户在菜单里选「按大小」，升还是降是他上一次定的那个。
    func setSortKey(_ key: DriveSortKey) {
        guard key != sortKey else { return }
        sortKey = key
        UserDefaults.standard.set(key.rawValue, forKey: Self.sortKeyDefaultsKey)
    }

    func setSortAscending(_ ascending: Bool) {
        guard ascending != sortAscending else { return }
        sortAscending = ascending
        UserDefaults.standard.set(ascending, forKey: Self.sortAscendingDefaultsKey)
    }

    // MARK: - 浏览

    /// 下钻到一个文件夹。
    ///
    /// 只对文件夹成立：文件点开是预览，不是一层。传进来的是文件时这一趟什么都不改
    /// （`current` 与 `path` 是一对，只动一半就会让「现在在哪一层」这件事自相矛盾）。
    func open(itemId: String, using client: APIClient) async {
        await load(itemId: itemId, intending: .push, using: client)
    }

    /// 回上一级。已经在根层就什么都不做。
    func up(using client: APIClient) async {
        guard !path.isEmpty else { return }
        let parent = DrivePath.popping(path)
        await load(itemId: parent.last?.id, intending: .replace(parent), using: client)
    }

    /// 面包屑跳转：第 0 级是「云盘」。
    func jump(to index: Int, using client: APIClient) async {
        let target = DrivePath.truncated(path, toDepth: index)
        await load(itemId: target.last?.id, intending: .replace(target), using: client)
    }

    /// 重取当前这一层。变更类接口之后、下拉刷新时都走它。
    func reload(using client: APIClient) async {
        await load(itemId: path.last?.id, intending: .replace(path), using: client)
    }

    /// 续页。
    func loadMore(using client: APIClient) async {
        guard !loading, !loadingMore,
              let snapshot = current,
              let page = snapshot.childrenPage,
              page.hasMore,
              let offset = page.nextOffset
        else { return }

        // 出发时是哪一层：`loading` 挡得住两次导航撞在一起，挡不住「续页 + 下钻」。
        let generation = layerGeneration
        loadingMore = true
        defer { loadingMore = false }
        do {
            let next = try await fetch(itemId: folderId, childrenOffset: offset, using: client)
            // 这期间层换了（人点进了别的文件夹、回了上一级、退出了登录）：这一页属于
            // 上一层，接上去就成了一份张冠李戴的列表，丢掉它。
            guard generation == layerGeneration else { return }
            // 只接子项那一页。`current` / `breadcrumbs` / `preview` 是这一层的元信息，
            // 续页不会让它们变——它们说的是「这一层是什么」，不是「这一页有哪些行」。
            current = DriveBrowserSnapshot(
                current: snapshot.current,
                breadcrumbs: snapshot.breadcrumbs,
                children: snapshot.children + next.children,
                childrenPage: next.childrenPage,
                preview: snapshot.preview,
                canDownload: snapshot.canDownload,
                canZip: snapshot.canZip
            )
            errorMessage = nil
        } catch {
            // 一次作废的请求失败了也不该在已经换过的这一层上留一句报错。
            guard generation == layerGeneration else { return }
            errorMessage = DriveText.errorMessage(error)
        }
    }

    /// 路径栈该怎么变。
    private enum PathIntent {
        /// 下钻：栈上追加这一层。
        case push
        /// 栈已经由调用方算好了（回上级 / 面包屑跳转 / 刷新），成了才落下去。
        case replace([DriveBrowserItem])
    }

    /// 拉一层并把它当成当前层。
    ///
    /// 路径栈的改动**等请求回来才落**：先改栈再请求的话，一个失败的回上一级会让标题
    /// 已经换成上一层、列表还是原来那一层——比这一次操作失败更难看。
    private func load(itemId: String?, intending intent: PathIntent, using client: APIClient) async {
        // 同一层的两次请求会互相覆盖，而一个双击会把同一个文件夹往栈上推两次。
        guard !loading else { return }
        loading = true
        defer { loading = false }

        // `loading` 挡得住两次导航，挡不住「请求在飞的时候被清空」（退出登录）。
        let generation = layerGeneration
        do {
            let snapshot = try await fetch(itemId: itemId, childrenOffset: nil, using: client)
            // 这一趟出发之后层已经被清掉或换掉了：它的数据属于上一个账号 / 上一层，
            // 落下去只会把 `path` 与 `current` 拆成两半。
            guard generation == layerGeneration else { return }
            switch intent {
            case .push:
                guard snapshot.current.isFolder else {
                    // 点开的是文件：`current` 与 `path` 一起不动，等预览那边自己取它的内容。
                    return
                }
                // 打开根（不经过面包屑的那条路）就等于回根层。
                path = snapshot.current.isRoot ? [] : DrivePath.pushing(snapshot.current, onto: path)
            case .replace(let newPath):
                path = newPath
            }
            current = snapshot
            errorMessage = nil
            // 层换完了：还在飞的那些续页从这一刻起都不再属于现在这一层。
            layerGeneration += 1
        } catch {
            guard generation == layerGeneration else { return }
            errorMessage = DriveText.errorMessage(error)
        }
    }

    private func fetch(
        itemId: String?,
        childrenOffset: Int?,
        using client: APIClient
    ) async throws -> DriveBrowserSnapshot {
        if let itemId {
            return try await client.driveItemSnapshot(itemId: itemId, childrenOffset: childrenOffset)
        }
        return try await client.driveRootSnapshot(childrenOffset: childrenOffset)
    }

    // MARK: - 文件夹操作

    /// 新建文件夹。建在当前这一层下；根层发 `null`（见 `folderId`）。
    ///
    /// 每个动作都返回「成了几项 / 哪几项没成」：新建只有一项，但汇总的形状与多选的那些
    /// 一致，调用方处理提示的那段代码就只有一份。
    @discardableResult
    func createFolder(name: String, using client: APIClient) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting([name]) { name in
            do {
                try await client.driveCreateFolder(parentId: folderId, name: name)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: name, reason: DriveText.errorMessage(error))
            }
        }
        await reloadAfterChange(outcome, using: client)
        return outcome
    }

    /// 改名。
    ///
    /// 名字是空的就当没发生：确认键在空名字时本来就是置灰的（Task 8 那张 sheet），这里
    /// 不编一句话去说它，也不发一个必定被拒的请求。
    @discardableResult
    func rename(item: DriveBrowserItem, to name: String, using client: APIClient) async -> DriveBatchOutcome {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return DriveBatchOutcome(succeeded: 0, failures: []) }

        let outcome = await DriveBatchOutcome.collecting([item]) { item in
            do {
                try await client.driveRenameItem(itemId: item.id, name: trimmed)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: item.name, reason: DriveText.errorMessage(error))
            }
        }
        await reloadAfterChange(outcome, using: client)
        return outcome
    }

    /// 移动。`parentId` 为 nil 是移到根。
    ///
    /// 「把文件夹移到它自己或它的子孙下」在本地就拦下来（`DrivePath.canMove`）。
    @discardableResult
    func move(
        _ items: [DriveBrowserItem],
        to parentId: String?,
        using client: APIClient
    ) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting(items) { item in
            guard DrivePath.canMove(itemId: item.id, into: parentId, path: path) else {
                return DriveBatchOutcome.Failure(
                    name: item.name,
                    reason: DrivePath.intoOwnDescendantReason
                )
            }
            do {
                try await client.driveMoveItem(itemId: item.id, parentId: parentId)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: item.name, reason: DriveText.errorMessage(error))
            }
        }
        await reloadAfterChange(outcome, using: client)
        return outcome
    }

    /// 移到回收站。字节还在，恢复走回收站那一页。
    @discardableResult
    func trash(_ items: [DriveBrowserItem], using client: APIClient) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting(items) { item in
            do {
                try await client.driveTrashItem(itemId: item.id)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: item.name, reason: DriveText.errorMessage(error))
            }
        }
        await reloadAfterChange(outcome, using: client)
        return outcome
    }

    /// 变更之后重取当前这一层。
    ///
    /// 那几个接口回的是 `DriveItemDto`，它缺 `previewKind` / `browserUrl`，接不上
    /// `DriveBrowserItem`——所以改了名字、删了一行之后，新样子只能靠再取一次拿到。
    /// 一项都没成时列表没变，不必多打一次请求。
    private func reloadAfterChange(_ outcome: DriveBatchOutcome, using client: APIClient) async {
        guard outcome.succeeded > 0 else { return }
        await reload(using: client)
    }

    // MARK: - 回收站

    /// 回收站一页。
    ///
    /// `search` 走服务端：本地筛只能筛到已经加载的那几十条，而搜索要的是整个回收站
    /// （服务端的 `search` 还匹配原路径与素材 id）。
    func loadTrash(search: String? = nil, using client: APIClient) async {
        let term = DriveSearchTerm.normalized(search)
        let account = accountGeneration
        // 这一次查询「认」哪一份结果：搜索词是这次这个，账号也还是原来那个。词是会连着
        // 变的（`.searchable` 每敲一下都可能发一次），而两次请求回来的顺序不保证——不认的话
        // 屏幕上会出现上一个词的结果。
        trashSearch = term
        trashLoading = true
        do {
            let page = try await client.driveTrash(search: term)
            // 作废的这一趟连 `trashLoading` 都不动：飞着的那一次才是现在该等的那一次。
            guard isCurrentTrash(term, account: account) else { return }
            trash = page.items
            trashTotal = page.total
            trashErrorMessage = nil
            trashLoading = false
        } catch {
            guard isCurrentTrash(term, account: account) else { return }
            trashErrorMessage = DriveText.errorMessage(error)
            trashLoading = false
        }
    }

    /// 恢复一条。普通项与公开素材是两条接口，走哪条由条目自己定（`DriveTrashRestore`）。
    ///
    /// 这一屏不动 `current`：恢复的是一项回到它原来的位置，而浏览那一层的列表由它自己
    /// 下拉或回来时刷新——两个屏不共享一次请求。
    @discardableResult
    func restoreTrashEntry(_ entry: DriveTrashEntry, using client: APIClient) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting([entry]) { entry in
            guard let target = DriveTrashRestore.target(for: entry) else {
                return DriveBatchOutcome.Failure(name: entry.name, reason: DriveTrashRestore.unresolvedReason)
            }
            do {
                switch target {
                case .item(let itemId):
                    try await client.driveRestoreItem(itemId: itemId)
                case .publicAsset(let assetId):
                    _ = try await client.driveRestorePublicAsset(assetId: assetId)
                }
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: entry.name, reason: DriveText.errorMessage(error))
            }
        }
        // 成了才重取：恢复的那一条要从这一页里消失，而「还剩多少」是服务端说了算。
        if outcome.succeeded > 0 { await loadTrash(search: trashSearch, using: client) }
        return outcome
    }

    /// 从回收站里移掉一条。用户看不见「彻底删除」，这一步之后字节由服务端按自己的节奏回收。
    @discardableResult
    func purgeTrashEntry(_ entry: DriveTrashEntry, using client: APIClient) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting([entry]) { entry in
            do {
                try await client.driveHideTrashItem(id: entry.id)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: entry.name, reason: DriveText.errorMessage(error))
            }
        }
        if outcome.succeeded > 0 { await loadTrash(search: trashSearch, using: client) }
        return outcome
    }

    private func isCurrentTrash(_ term: String?, account: Int) -> Bool {
        term == trashSearch && account == accountGeneration
    }

    // MARK: - 分享

    /// 分享列表。服务端只给还活着的那些（`enabled: true` 且没过期），所以每一行都还能点开。
    func loadShares(using client: APIClient) async {
        let account = accountGeneration
        sharesLoading = true
        defer { sharesLoading = false }
        do {
            let page = try await client.driveShares()
            guard account == accountGeneration else { return }
            shares = page.items
            sharesErrorMessage = nil
        } catch {
            guard account == accountGeneration else { return }
            sharesErrorMessage = DriveText.errorMessage(error)
        }
    }

    /// 这一项已有的那一条活跃分享（本机知道的话）。详情页据此多一行「分享」。
    func existingShare(forItemId itemId: String) -> DriveShare? {
        DriveSharePlan.existing(forItemId: itemId, in: shares)
    }

    /// 分享一项。
    ///
    /// 已有那一条、而且用户什么都没改时**不发请求**，直接把本机手里那条给结果页
    /// （`DriveSharePlan`）。本机不知道的那一种「已有」（只知道浏览行上的 `shareUrl`、
    /// 手里没有链接）仍然走一次请求：服务端会把那一条更新（或复用）掉，回来的还是同一个
    /// 地址。这一趟不往本机存东西，所以没有账号代次要认。
    func share(
        item: DriveBrowserItem,
        settings: APIClient.DriveShareSettings,
        using client: APIClient
    ) async -> DriveShareOutcome {
        switch DriveSharePlan.of(itemId: item.id, known: shares, settings: settings) {
        case .useExisting(let existing):
            return .reused(existing)

        case .request(let body):
            // 本来就有吗：`shareUrl` 是服务端按这一项的 `shareId` 给的，非空就是有；
            // 分享列表里那一条也算。结果页据此决定要不要说「链接未变」。
            let hadShare = item.shareUrl?.isEmpty == false
                || DriveSharePlan.existing(forItemId: item.id, in: shares) != nil
            do {
                let share = try await client.driveCreateShare(itemId: item.id, settings: body)
                return hadShare ? .reused(share) : .created(share)
            } catch {
                return .failed(reason: DriveText.errorMessage(error))
            }
        }
    }

    /// 关掉一条分享。链接立刻失效，记录还在。
    @discardableResult
    func disableShare(_ share: DriveShareListItem, using client: APIClient) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting([share]) { share in
            do {
                try await client.driveDisableShare(id: share.id)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(
                    name: share.itemName,
                    reason: DriveText.errorMessage(error)
                )
            }
        }
        if outcome.succeeded > 0 { await loadShares(using: client) }
        return outcome
    }

    // MARK: - 公开素材

    /// 公开素材。它是平铺的一页，没有文件夹。
    func loadAssets(using client: APIClient) async {
        let account = accountGeneration
        assetsLoading = true
        defer { assetsLoading = false }
        do {
            let page = try await client.drivePublicAssets()
            guard account == accountGeneration else { return }
            assets = page.items
            assetsErrorMessage = nil
        } catch {
            guard account == accountGeneration else { return }
            assetsErrorMessage = DriveText.errorMessage(error)
        }
    }

    /// 一条素材给用户的那条直链（服务端给了就用它的，没给才自己拼）。
    func directLink(for asset: DrivePublicAsset, origin: URL = AppConfiguration.apiOrigin) -> String {
        DrivePublicAssetLink.directLink(for: asset, origin: origin)
    }

    /// 改名。公开素材是平铺的、允许重名，所以这一条只动它自己。
    ///
    /// 接口回来的是改完之后的那**一条完整素材**（`url`、访问次数都在），就地换掉就行，
    /// 不像云盘里的项那样只能重取整页。
    @discardableResult
    func renameAsset(
        _ asset: DrivePublicAsset,
        to name: String,
        using client: APIClient
    ) async -> DriveBatchOutcome {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return DriveBatchOutcome(succeeded: 0, failures: []) }

        let outcome = await DriveBatchOutcome.collecting([asset]) { asset in
            do {
                let updated = try await client.driveRenamePublicAsset(assetId: asset.assetId, name: trimmed)
                replaceAsset(updated)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: asset.name, reason: DriveText.errorMessage(error))
            }
        }
        return outcome
    }

    /// 移入回收站。直链当下就不可用，素材还在回收站里等恢复。
    @discardableResult
    func trashAsset(_ asset: DrivePublicAsset, using client: APIClient) async -> DriveBatchOutcome {
        let outcome = await DriveBatchOutcome.collecting([asset]) { asset in
            do {
                _ = try await client.driveTrashPublicAsset(assetId: asset.assetId)
                return nil
            } catch {
                return DriveBatchOutcome.Failure(name: asset.name, reason: DriveText.errorMessage(error))
            }
        }
        // 进了回收站就不再属于这一页，就地去掉（回收站那一屏下次进去自己会重取）。
        if outcome.succeeded > 0 { assets.removeAll { $0.assetId == asset.assetId } }
        return outcome
    }

    /// 改名之后就地换掉那一条：列表按 `assetId` 认行，`itemId` 会随删除重建而变。
    private func replaceAsset(_ asset: DrivePublicAsset) {
        guard let index = assets.firstIndex(where: { $0.assetId == asset.assetId }) else { return }
        assets[index] = asset
    }

    // MARK: - 用量

    /// 用量。
    ///
    /// 拉失败不弹错：它只喂列表最底下那一行「已用 X / Y」，为它盖一层错误提示挡住整张列表
    /// 不划算——记进日志，那一行这一次不显示。
    func loadUsage(using client: APIClient) async {
        let account = accountGeneration
        do {
            let value = try await client.driveUsage()
            guard account == accountGeneration else { return }
            usage = value
        } catch {
            guard account == accountGeneration else { return }
            AppLog.drive.warning("drive usage unavailable: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// 退出登录时清干净：下一个账号不该看到上一个账号的文件名与目录结构。
    ///
    /// 排序偏好不清：它是这台手机上的视图偏好，不属于任何一个账号。
    func clear() {
        path = []
        current = nil
        errorMessage = nil
        loading = false
        loadingMore = false
        // 在飞的那些请求回来时不能把上一个账号的列表重新填进 `current`。
        layerGeneration += 1

        // 回收站、分享、公开素材与用量同样是账号级的东西：漏掉哪一个，下一个账号就会看到
        // 上一个人的回收站、分享链接与直链。
        accountGeneration += 1
        trash = []
        trashTotal = 0
        trashLoading = false
        trashErrorMessage = nil
        trashSearch = nil
        shares = []
        sharesLoading = false
        sharesErrorMessage = nil
        assets = []
        assetsLoading = false
        assetsErrorMessage = nil
        usage = nil
    }
}
