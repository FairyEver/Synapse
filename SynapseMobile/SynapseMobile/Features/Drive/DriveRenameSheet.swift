import SwiftUI

/// 名字输入框的判据。
///
/// 只有空白的名字在屏幕上看得见、却不是一个名字，所以判据看的是去掉两端空白之后的那一份，
/// 而输入框里留着用户敲的原样。抽成独立函数是因为本仓已经有同一个判据要在两处成立
/// （这里置灰确认键，`DriveStore.rename` 那边静默丢弃），而它是这两处唯一的共同真相。
enum DriveRenameInput {
    /// 真正会发出去的那个名字。
    static func trimmed(_ draft: String) -> String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 确认键亮不亮。
    static func isConfirmable(_ draft: String) -> Bool {
        !trimmed(draft).isEmpty
    }
}

/// 新建文件夹、云盘项改名与公开素材改名共用的一张。
///
/// 三件事只差三处：标题、确认键上的字、输入框里预填什么。做成一件事带一个 `Purpose`，
/// 而不是三张长得一样的 sheet —— 本仓已经吃过「同一件事在两处两种样子」的账。
struct DriveRenameSheet: View {
    /// 这一张在做哪一件事。
    enum Purpose: Equatable {
        case createFolder
        case rename(DriveBrowserItem)
        /// 公开素材改名。它也是「改一个名字」，所以共用这一张 —— 只是那一项不是云盘里的
        /// 节点（`DrivePublicAsset`），改完接口会把整条素材原样还回来。
        case renameAsset(DrivePublicAsset)

        var title: String {
            switch self {
            case .createFolder: return "新建文件夹"
            case .rename, .renameAsset: return "重命名"
            }
        }

        var confirmTitle: String {
            switch self {
            case .createFolder: return "创建"
            case .rename, .renameAsset: return "保存"
            }
        }

        /// 输入框打开时里面的东西。
        ///
        /// 新建预填一个名字（系统「文件」App 与原型都是这么做的），要改成别的就自己清掉；
        /// 改名打开在现在的名字上，多数改名只动一两个字。
        var initialName: String {
            switch self {
            case .createFolder: return "未命名文件夹"
            case .rename(let item): return item.name
            case .renameAsset(let asset): return asset.name
            }
        }

        /// 失败那一句里怎么说这件事，`DriveBatchOutcome.noticeText` 要它。
        var actionLabel: String {
            switch self {
            case .createFolder: return "创建"
            case .rename, .renameAsset: return "重命名"
            }
        }
    }

    let purpose: Purpose
    /// 当前这一层的名字（`DriveStore.title`）。新建时用它说清建在哪一层里。
    let parentName: String

    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: String
    @State private var running = false
    @FocusState private var focused: Bool

    init(purpose: Purpose, parentName: String) {
        self.purpose = purpose
        self.parentName = parentName
        // 名字要在画出来那一刻就在框里，`onAppear` 可能落在用户已经敲了字之后。
        _draft = State(initialValue: purpose.initialName)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("名称", text: $draft)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit(commit)
                        .disabled(running)
                        .accessibilityIdentifier("drive-rename-field")
                } footer: {
                    if case .createFolder = purpose {
                        // 不说清建在哪一层，用户只能从「建完它去哪了」反推。
                        Text("建在「\(parentName)」里")
                    }
                }
            }
            .navigationTitle(purpose.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(running)
                }
                ToolbarItem(placement: .confirmationAction) {
                    // 空名字（含只有空白）时置灰：一个必定被服务端拒的请求不该发出去，
                    // 而这一颗按钮正是用户刚清空输入框时看到的那一颗。
                    Button(purpose.confirmTitle, action: commit)
                        .disabled(!DriveRenameInput.isConfirmable(draft) || running)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .onAppear { focused = true }
        // 这一张自己会发提示（失败那一句），而提示条画在宿主屏幕上、在这一张之下 ——
        // 不在这里挂一份就永远看不见。`TerminalGitPanel` 对第二层弹窗是同一个做法。
        .noticeOverlay(model)
    }

    /// 确认。
    ///
    /// 请求在**这一张还开着**的时候发（确认键转圈、输入框锁住），落地了才收：先收再发的话
    /// 一个失败就没得重试了，用户刚敲的名字也跟着没了。失败不关这张，那一句原因由这一张
    /// 自己的提示条说。
    private func commit() {
        guard !running else { return }
        let name = DriveRenameInput.trimmed(draft)
        guard !name.isEmpty else { return }
        running = true
        Task {
            let outcome = await perform(name)
            running = false
            if let notice = outcome.noticeText(purpose.actionLabel) {
                model.notice(notice, tone: .failure)
                return
            }
            // 成了：列表由 store 自己重取（`reloadAfterChange`），这一张要做的就是收起来。
            dismiss()
        }
    }

    private func perform(_ name: String) async -> DriveBatchOutcome {
        switch purpose {
        case .createFolder:
            return await model.driveCreateFolder(name: name)
        case .rename(let item):
            return await model.driveRename(item: item, to: name)
        case .renameAsset(let asset):
            return await model.driveRenameAsset(asset, to: name)
        }
    }
}
