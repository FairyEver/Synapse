import Foundation
import Observation

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

        loadingMore = true
        defer { loadingMore = false }
        do {
            let next = try await fetch(itemId: folderId, childrenOffset: offset, using: client)
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

        do {
            let snapshot = try await fetch(itemId: itemId, childrenOffset: nil, using: client)
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
        } catch {
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

    /// 退出登录时清干净：下一个账号不该看到上一个账号的文件名与目录结构。
    ///
    /// 排序偏好不清：它是这台手机上的视图偏好，不属于任何一个账号。
    func clear() {
        path = []
        current = nil
        errorMessage = nil
        loading = false
        loadingMore = false
    }
}
