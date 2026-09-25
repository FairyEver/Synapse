import SwiftUI

/// 一批动作收尾时该不该说话。
///
/// 全成时不说：列表已经变了（`DriveStore` 自己重取），再报一句「3 项移动成功」是重复状态。
/// 有失败时必须说，而且要说清几项成、哪几项没成、为什么 —— 点名那半句是 Spec §5.2 要的：
/// 多选时用户盯着的是列表，只说数量就不知道留下的那一项是哪一个。
extension DriveBatchOutcome {
    /// 该说给用户的那一句；什么都没失败时是 nil。
    func noticeText(_ action: String) -> String? {
        guard failed > 0 else { return nil }
        // 一项的时候不必报「1 项移动失败」：那一次就只有一个名字，说它俩就够了。
        var text = total > 1 ? summary(action) : "\(action)失败"
        if let sentence = failureSentence { text += "：" + sentence }
        return text
    }
}

/// 一次移动能选哪些目标。
enum DriveMoveTargets {
    /// 这一层里能当目标的，是**子文件夹里去掉要移动的那几项自己**。
    ///
    /// 子孙不必单独排除：一个文件夹只有一条路径，进不去它自己就进不去它的子树 —— 选择器
    /// 只能一层层往下走，而被排除的那一项根本不在列表里。
    ///
    /// `DrivePath.canMove` 在这里帮不上忙，也不能用它来代替这一条：那个判定读的是浏览层的
    /// 路径栈，而选中的项永远是当前层的子项、栈是它的祖先链 —— 对真实的移动流程它恒真。
    /// 环只能由选择器自己挡在前面（服务端会拒，但让用户点进去才发现是坏体验）。
    static func selectable(
        _ children: [DriveBrowserItem],
        movingIds: Set<String>
    ) -> [DriveBrowserItem] {
        children.filter { $0.isFolder && !$0.isRoot && !movingIds.contains($0.id) }
    }
}

/// 移动目标：一棵能一层层走下去的文件夹树。
///
/// 从**当前这一层**出发，可以一层层往上去（要移到兄弟文件夹里就得先上去）—— 这也是原型
/// 的形状。底部那颗「移到这一层」确认的是现在停着的这一层，所以往下走只为找目标，不改变
/// 选中。
///
/// 走的是自己这一份取数，不借 `DriveStore` 的导航状态：那会把用户正看着的那一层挪走
/// （下钻一次，背后的列表就换了一层）。
struct DriveMoveTargetPicker: View {
    /// 要移的那几项。
    let items: [DriveBrowserItem]
    /// 从哪一层开始：浏览层现在这一层（`DriveStore.path`，根层是空数组）。
    let from: [DriveBrowserItem]
    /// 移动这一趟有结果了。多选那一批要据此重新定选择：移走了的那几项不在这一层了，
    /// 没移成的那几项还在（Spec §5.2「成功的从列表移除，失败的保留选中」），
    /// 所以参数要带出来，调用方才能把选择**留给失败的那几项**而不是一律清空。
    let onMoved: (DriveBatchOutcome) -> Void

    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// 现在停在哪一层：从头（根）往下一级一级存文件夹。
    @State private var chain: [DriveBrowserItem]
    @State private var children: [DriveBrowserItem] = []
    @State private var loading = true
    @State private var loadingMore = false
    @State private var errorMessage: String?
    /// 还有下一页时那个偏移量；到尽头就是 nil。
    @State private var nextOffset: Int?
    @State private var moving = false

    init(
        items: [DriveBrowserItem],
        from: [DriveBrowserItem],
        onMoved: @escaping (DriveBatchOutcome) -> Void
    ) {
        self.items = items
        self.from = from
        self.onMoved = onMoved
        _chain = State(initialValue: from)
    }

    private var movingIds: Set<String> { Set(items.map(\.id)) }

    /// 这一层往下走一层就是换了一层，取数跟着它走。
    private var levelId: String? { chain.last?.id }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("移动到")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { dismiss() }
                            .disabled(moving)
                    }
                }
                .safeAreaInset(edge: .bottom) { confirmBar }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task(id: levelId) { await loadLevel() }
        // 失败那一句要看得见：提示条画在宿主屏幕上、在这一张之下。
        .noticeOverlay(model)
    }

    // MARK: - 内容

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            ContentUnavailableView {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
            } actions: {
                Button { Task { await loadLevel() } } label: {
                    Text("重试").frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                }
            }
        } else {
            List {
                Section {
                    if !chain.isEmpty {
                        Button(action: up) {
                            row("上一层", systemImage: "arrow.up", tint: .secondary)
                        }
                        .disabled(moving)
                    }
                    ForEach(children) { folder in
                        Button { enter(folder) } label: {
                            row(folder.name, systemImage: "folder.fill", tint: Color(uiColor: .systemBlue), chevron: true)
                        }
                        .disabled(moving)
                    }
                    if children.isEmpty {
                        // 空一层也要有个说法：这一屏下面那颗按钮还指着「这一层」，而它此刻
                        // 一个子文件夹都没有。
                        Text("这里没有子文件夹")
                            .foregroundStyle(.secondary)
                    }
                    if nextOffset != nil {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowSeparator(.hidden)
                            .onAppear { Task { await loadMore() } }
                    }
                } footer: {
                    // 现在停在哪：上面那张列表只说明下一层能去哪，说明不了这一层是哪里。
                    Text(subtitle)
                }
            }
        }
    }

    /// 一行：图标 + 名字，目标那一行多一个 chevron。
    ///
    /// 44pt 加在 label 上而不是按钮外面：加在外面只是把按钮摆在一块 44pt 高的空地中间，
    /// 按到边缘不算数。
    private func row(
        _ title: String,
        systemImage: String,
        tint: Color,
        chevron: Bool = false
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text(title)
                .foregroundStyle(.primary)
                .lineLimit(1)
            Spacer(minLength: 8)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: Metrics.minimumTapTarget)
        .contentShape(Rectangle())
    }

    /// 停在哪一层，以及这一趟要移几项。
    private var subtitle: String {
        let path = ([DriveText.rootTitle] + chain.map(\.name)).joined(separator: " / ")
        return items.count > 1 ? "\(path) · \(items.count) 项" : path
    }

    private var confirmBar: some View {
        Button(action: move) {
            Group {
                if moving {
                    ProgressView()
                } else {
                    Text("移到这一层")
                }
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget)
        }
        .buttonStyle(.borderedProminent)
        .disabled(moving)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: - 换一层

    /// 下钻到一个文件夹。
    ///
    /// 新的一层先清成加载态再去取数（取数在 `.task(id:)` 里）。清晚了会有一帧画着上一层
    /// 的子文件夹，而屏幕下方那行字已经是新的一层了 —— 看着像点进了别的地方。
    private func enter(_ folder: DriveBrowserItem) {
        reloading()
        chain.append(folder)
    }

    /// 回上一层。已经在根层就什么都不做（这一行在根层不显示）。
    private func up() {
        guard !chain.isEmpty else { return }
        reloading()
        chain = DrivePath.popping(chain)
    }

    private func reloading() {
        loading = true
        errorMessage = nil
        children = []
        nextOffset = nil
    }

    // MARK: - 取数

    /// 拉现在这一层。
    private func loadLevel() async {
        loading = true
        errorMessage = nil
        let level = levelId
        do {
            let snapshot = try await model.driveSnapshot(itemId: level)
            // 这一趟出发之后用户可能已经换了一层（上去、进了别的文件夹）：这一页属于上一层，
            // 接上去就是一份张冠李戴的名单，和第 51 个子文件夹一样够不着。
            guard level == levelId else { return }
            apply(snapshot, replacing: true)
            loading = false
        } catch {
            guard level == levelId else { return }
            children = []
            nextOffset = nil
            errorMessage = DriveText.errorMessage(error)
            loading = false
        }
    }

    /// 续页。
    ///
    /// 选择器要能看见**所有**子文件夹，而一页只有 50 个：只画第一页的话，第 51 个子文件夹
    /// 在手机上根本够不着，用户会以为它不在那儿。
    private func loadMore() async {
        guard !loading, !loadingMore, let offset = nextOffset else { return }
        loadingMore = true
        defer { loadingMore = false }
        let level = levelId
        do {
            let snapshot = try await model.driveSnapshot(itemId: level, childrenOffset: offset)
            guard level == levelId else { return }
            apply(snapshot, replacing: false)
        } catch {
            // 续页失败不动已经画出来的那些：一次网络抖动不该把这一层的名单擦掉。
            guard level == levelId else { return }
            model.notice(DriveText.errorMessage(error), tone: .failure)
        }
    }

    private func apply(_ snapshot: DriveBrowserSnapshot, replacing: Bool) {
        let next = DriveMoveTargets.selectable(snapshot.children, movingIds: movingIds)
        if replacing {
            children = next
        } else {
            // 服务端是按偏移量分页的，而这一页里的项与上一页理论上不该重（同一层在同一时刻
            // 内容不变），但两次请求之间有人往这一层里放了东西就可能重。按 id 去一次重，
            // 重复的行在 SwiftUI 里会让 `ForEach` 报身份冲突。
            let known = Set(children.map(\.id))
            children += next.filter { !known.contains($0.id) }
        }
        let page = snapshot.childrenPage
        nextOffset = page?.hasMore == true ? page?.nextOffset : nil
    }

    // MARK: - 移动

    /// 移到现在停着的这一层。
    ///
    /// 请求在这一张还开着的时候发（底部那颗转圈），落地了才收：一项都没成时留着这一张，
    /// 让用户换个目标再来一次；有几项成了就把选择清掉收起来 —— 那几项已经不在这一层了，
    /// 而没成的那几个由提示条点名。
    private func move() {
        guard !moving else { return }
        moving = true
        let target = levelId
        Task {
            let outcome = await model.driveMove(items, to: target)
            moving = false
            guard let notice = outcome.noticeText("移动") else {
                onMoved(outcome)
                dismiss()
                return
            }
            model.notice(notice, tone: .failure)
            if outcome.succeeded > 0 {
                onMoved(outcome)
                dismiss()
            }
        }
    }
}
