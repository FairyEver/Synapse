import SwiftUI

/// 简介里那几行（Spec §4.8）。
///
/// 全是纯函数：列表里显示不下的那几样（种类、完整路径）都在这里，算错了不会崩，只会让人
/// 读错，所以边界钉在 `DriveDialogTests`。
enum DriveItemInfo {
    /// 种类。文件夹就是「文件夹」，文件带上扩展名（「PDF 文件」）。
    ///
    /// 没有扩展名时只说「文件」：图标那边在这种情况下留白，这里也不该编一个类型出来
    /// （Spec §4.3 那张表最后一行）。
    static func kind(_ item: DriveBrowserItem) -> String {
        guard !item.isFolder else { return "文件夹" }
        let badge = DriveText.badge(of: item.name)
        return badge.isEmpty ? "文件" : "\(badge) 文件"
    }

    /// 大小。文件夹没有这一格，读不出来用「—」。
    ///
    /// 文件夹不报大小：服务端给的是它自己那个节点的大小，不是里面那些东西的和，报出来
    /// 会小得离谱（与列表副标题同一条判据）。读不出来的文件也不能报「0 字节」。
    static func size(_ item: DriveBrowserItem) -> String {
        guard !item.isFolder, let bytes = item.sizeBytes else { return "—" }
        return DriveText.bytes(String(bytes))
    }

    /// 修改时间。服务端的时间戳读不出来时是「—」，不是一行空白。
    static func modified(_ item: DriveBrowserItem) -> String {
        let date = DriveText.date(item.updatedAt)
        return date.isEmpty ? "—" : date
    }

    /// 完整路径：从「云盘」这一级一路写下来。
    ///
    /// `path` 是这一项**所在那一层**的路径栈（`DriveStore.path`，根层是空数组），所以
    /// 末尾要自己接上这一项的名字。分隔符与面包屑同一种写法。
    static func location(path: [DriveBrowserItem], name: String) -> String {
        ([DriveText.rootTitle] + path.map(\.name) + [name]).joined(separator: " / ")
    }
}

/// 显示简介（Spec §4.8）。
///
/// 一项的静态信息一份：列表里放不下的都在这里，位置那一行给完整路径。有活跃分享时多一行
/// 「分享」，点进去就是分享结果页——那边会看到链接，而不是再建一个。
struct DriveItemInfoView: View {
    let item: DriveBrowserItem
    /// 这一项现在在哪一层：浏览层的路径栈（根层是空数组）。位置那一行由它拼。
    let path: [DriveBrowserItem]
    /// 这一页里的分享那一层动过分享（建过、或者读到了本机记着的那条）时发一次。
    let onShared: () -> Void

    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var sharing = false

    init(
        item: DriveBrowserItem,
        path: [DriveBrowserItem],
        onShared: @escaping () -> Void = {}
    ) {
        self.item = item
        self.path = path
        self.onShared = onShared
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("名称") {
                        Text(item.name)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("种类", value: DriveItemInfo.kind(item))
                    LabeledContent("大小", value: DriveItemInfo.size(item))
                    LabeledContent("修改时间", value: DriveItemInfo.modified(item))
                    LabeledContent("位置") {
                        Text(DriveItemInfo.location(path: path, name: item.name))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                            // 一整条路径都可能有用（用户要拿它去别处找同一层），而它
                            // 长到一行放不下：可选中、可长按拷贝（Spec §4.8）。
                            .textSelection(.enabled)
                    }
                }
                if hasShare {
                    Section {
                        Button { sharing = true } label: {
                            HStack(spacing: 12) {
                                Text("分享")
                                    .foregroundStyle(.primary)
                                Spacer(minLength: 8)
                                Text("已开启")
                                    .foregroundStyle(Color(uiColor: .systemBlue))
                                Image(systemName: "chevron.forward")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                            // 整行都是点击目标，44pt 也加在这一行上，不是按钮外面。
                            .frame(minHeight: Metrics.minimumTapTarget)
                            .contentShape(Rectangle())
                        }
                    }
                }
            }
            .navigationTitle("简介")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // 分享那一层盖在这一页上（`TerminalGitPanel` 对第二层弹窗是同一个做法）：点「分享」
        // 之后用户还在看这一项，只是要从「简介」换到「链接」。
        .sheet(isPresented: $sharing) {
            DriveShareSheet(item: item, onShared: onShared)
        }
        // 分享那一层的「已复制」要看得见：提示条画在宿主屏幕上、在这些弹窗之下。
        .noticeOverlay(model)
    }

    /// 这一项有没有活跃分享。
    ///
    /// 两个来源都要：分享列表拉过时以它为准；没拉过时浏览行那枚角标（`shareUrl` 是站内
    /// 路径，`/share/{shareId}`）是唯一还看得出「这一项已经被分享过」的地方。
    private var hasShare: Bool {
        model.drive.existingShare(forItemId: item.id) != nil
            || DriveShareLink.shareId(inBrowserPath: item.shareUrl) != nil
    }
}
