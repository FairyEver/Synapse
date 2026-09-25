import Foundation

/// Mirror of `shared/src/live.ts` and `shared/src/mobile-live.ts`.
///
/// The phone sits on the opposite side of the same envelopes as a desktop: it
/// sends what a desktop receives and receives what a desktop sends. The names
/// here follow the phone's perspective so the call sites read correctly.

enum LiveMessageType {
    static let hello = "live.hello"
    static let welcome = "live.welcome"
    static let ping = "live.ping"
    static let pong = "live.pong"
    static let mobileSummary = "mobile.summary"
    static let mobileFrame = "mobile.frame"
    static let mobileIntent = "mobile.intent"
    static let mobileIntentResult = "mobile.intentResult"
    static let mobileTransferProgress = "mobile.transferProgress"
    static let mobileDetached = "mobile.detached"
    static let mobilePresence = "mobile.presence"
    static let notificationChanged = "notification.changed"
    /// The command buttons a computer offers this phone. A family of its own rather
    /// than part of the summary, whose byte budget cannot carry them.
    static let mobileToolbar = "mobile.toolbar"
    /// 一台电脑上那些配了启动命令的分组，手机用它决定分组行上画不画箭头。
    ///
    /// 与工具栏同族、同样独立：摘要的字节预算装不下它（理由见 `mobileToolbar` 那条），
    /// 而且「这台电脑没给任何分组配命令」与「这台电脑太旧、还不认识这条消息」是两回事。
    /// 手机对两者的表现相同（都不画箭头），但它们不能混成一份状态。
    static let mobileGroupCommands = "mobile.groupCommands"
    /// The sentences a computer's 快捷输入 app holds, for this phone to tap into its
    /// composer. Beside the toolbar rather than part of it: the two come from two
    /// different computer apps, and having none of these is not having no toolbar —
    /// the toolbar has built-in buttons to fall back to and a sentence is the user's
    /// own words, with nothing to stand in for them.
    static let mobileQuickPhrases = "mobile.quickPhrases"
    /// The text this computer has copied recently, for this phone to copy again.
    ///
    /// The third of the "what this computer has" family, and the one that is *not* a
    /// whole truth: the computer keeps twenty entries and this phone keeps fifty, so
    /// what arrives is merged into the local list rather than replacing it. See
    /// `ClipboardHistoryStore` — getting that wrong silently shrinks the phone's list,
    /// which is why the rule lives in one place with the arithmetic spelled out.
    static let mobileClipboard = "mobile.clipboard"
    /// The Git state of the directory a terminal is sitting in, on one computer.
    ///
    /// 与上面三条「这台电脑有什么」不同，它是**点对点**的：它答的是「你正开着的那个
    /// 终端」，所以载荷里带着 `sessionId` 与收件人的 `mobileClientInstanceId`。
    ///
    /// 一条与摘要有明确边界的消息：摘要在有输出时以 1 Hz 刷新，而这一份要跑一次
    /// `git status` —— 骑上去等于每秒 spawn 一次 git。所以它按「目录变了」推，
    /// 手机端拉一次面板也会让电脑重算一遍。
    static let mobileGitStatus = "mobile.gitStatus"
}

/// Which of the user's computers are reachable right now.
///
/// The socket is to the cloud, not to a computer, so a desktop signing in or
/// dropping out is invisible here without this. It carries the whole list rather
/// than a delta, so replacing what we hold is always correct.
///
/// Ids only, deliberately: this is fanned out to every phone of the account, and a
/// phone that is not looking at the picker has no use for the names. The names come
/// from `APIClient.onlineDesktops()` — see `ReachableDesktop`.
struct MobilePresencePayload: Decodable {
    let desktopClientInstanceIds: [String]
}

/// The Git state of the directory a terminal is sitting in.
///
/// 只认路径：它与 Synapse 的「代码仓库」那套没有产品关系，一个目录不必先被用户添加过
/// 仓库就能有状态。字段就是手机第二行与 Git 面板画得出的那几个 —— **改动文件清单不在
/// 其中**，手机端不接收任何文件清单。
struct MobileGitStatus: Decodable, Equatable {
    /// 电脑在哪个目录上干的活。面板的「目录」行直接显示它。
    let cwd: String
    /// `nil` = 游离 HEAD；那时代替它显示的是 `detachedSha`。
    let branch: String?
    let detachedSha: String?
    let upstream: String?
    let ahead: Int
    let behind: Int
    let changeCount: Int
    let hasConflicts: Bool

    private enum CodingKeys: String, CodingKey {
        case cwd, branch, detachedSha, upstream, ahead, behind, changeCount, hasConflicts
    }
}

/// One terminal's Git state on one computer, sent to the one phone that is watching it.
///
/// `status` 的 `nil` 是**一个答案**（这个目录不是 Git 仓库），而不是缺席：手机端
/// 「不是仓库」与「还没收到回答」是两种完全不同的状态 —— 前者第二行退回显示版本号，
/// 后者保持现状不动 —— 所以整条消息的缺席与它必须分得开。见 `TerminalGitStatusState`。
struct MobileGitStatusPayload: Decodable, Equatable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let sessionId: String
    let revision: Int
    /// `nil` = 这个目录不是 Git 仓库。
    let status: MobileGitStatus?

    private enum CodingKeys: String, CodingKey {
        case desktopClientInstanceId, mobileClientInstanceId, sessionId, revision, status
    }
}

/// One computer this account can reach right now, as the picker offers it.
///
/// The name is optional because it arrives on a field a server that predates it
/// does not send. An absent name is a computer this phone can still reach and
/// still switch to — it is a worse label, not a different machine — so the list
/// keeps it either way rather than hiding a computer it cannot name.
struct ReachableDesktop: Identifiable, Equatable {
    let clientInstanceId: String
    let deviceName: String?

    var id: String { clientInstanceId }

    /// What to draw for it. Falls back to the id, which is at least unique and lets
    /// someone who knows their client ids tell the two apart.
    var label: String { deviceName ?? clientInstanceId }
}

/// 一条下行消息的 `type`。先只解这一格，再按它去解具体载荷。
///
/// 载荷的形状由 `type` 决定，而 Swift 的 `Decodable` 不能在解到一半时改主意，所以
/// 这条路要么走两趟，要么先把载荷物化成一份与类型无关的中间表示。这里走**两趟**。
///
/// 中间表示那条路（一个 `[String: JSONValue]` 树 + 编码回 Data 再解一次）看着只解
/// 一遍，实际是**三遍**：建树、重新序列化、再解析。而 `JSONValue` 认类型靠的是连着
/// `try?` 几个候选，**每失败一次就抛一个 `DecodingError`**，一条帧里每一行的 text
/// 都要这么来一遍。帧是这条路上最重的载荷，终端持续输出时每秒到好几次，且全程在主
/// actor 上（`RealtimeClient` 就是 `@MainActor`）。两趟直解比那三趟便宜得多，也不需要
/// 一棵一次性的树。
struct LiveEnvelopeType: Decodable {
    let type: String
}

/// 一次解析，直接落到具体类型。`type` 已经由 `LiveEnvelopeType` 判过。
struct PayloadEnvelope<Payload: Decodable>: Decodable {
    let payload: Payload
}

// MARK: - Summary

struct MobileSummaryGroup: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct MobileSummaryAttention: Decodable, Hashable {
    let state: String
    let kind: String

    var isWaiting: Bool { state == "waiting" }
}

struct MobileSummarySession: Decodable, Identifiable, Hashable {
    let id: String
    let groupId: String
    let title: String
    let status: String
    let attention: MobileSummaryAttention
    let cwd: String
    let cols: Int
    let rows: Int
    let startedAt: String
    let lastLine: String
    let lastOutputSeq: Int
    /// The phone deciding this session's grid, by its client instance id.
    ///
    /// Absent for a terminal the computer's own layout decides, which is the
    /// ordinary case. Seeing this phone's id means its claim still stands; seeing
    /// somebody else's, or none where this phone's used to be, means the grid is no
    /// longer its to size — which is the only way the desktop's own release reaches
    /// here, since it is a local act there.
    let gridOwnerId: String?

    var isRunning: Bool { status == "running" }
    /// 这台电脑现在还愿不愿意打开它。
    ///
    /// 与电脑那条 `attach` 的门槛是同一个门槛：它接受 `running` 与 `stopping`，其余
    /// （`ended` / `failed` / `lost`）一律回「该终端已结束。」。两边判据不一致的地方，就是
    /// 上一次那块黑屏长出来的地方 —— 手机按自己的判据进去了，电脑按自己的判据拒绝，中间
    /// 那段空白由用户承担。所以这一条**故意**与
    /// `desktop/electron/services/mobile-gateway/intent-executor.ts` 的 `attach` 分支
    /// 保持一致，改一边必须改另一边。
    var canBeOpened: Bool { status == "running" || status == "stopping" }
    /// 这个终端是什么时候开的，用来算「运行了多久」。
    ///
    /// 读法必须是 `parseWireTimestamp`：桌面端那一头是 `new Date().toISOString()`，
    /// 带毫秒，而默认的 `ISO8601DateFormatter` 读不了它 —— 这里以前就是这么写的，
    /// 于是会话行右侧那一格永远是空的（见 `WireTimestamp.swift`）。
    var startedAtDate: Date? { ISO8601DateFormatter.parseWireTimestamp(startedAt) }
}

/// The four model tiers a Provider can name, in the order the desktop shows them.
///
/// The desktop's own `ModelTier` and this are the same closed set; the wire carries
/// the raw strings, so this is a decode target rather than a mapping.
enum MobileModelTier: String, Codable, CaseIterable, Hashable, Sendable {
    case `default`
    case opus
    case sonnet
    case haiku

    /// The order the desktop's picker lists them in — its own `MODEL_TIER_DISPLAY_ORDER`.
    static let displayOrder: [MobileModelTier] = [.default, .opus, .sonnet, .haiku]

    var label: String {
        switch self {
        case .default: return "主模型"
        case .opus: return "Opus"
        case .sonnet: return "Sonnet"
        case .haiku: return "Haiku"
        }
    }
}

/// One project a conversation may be started in.
///
/// `projectId` is what goes back in `createAgentConversation`; it is the desktop's
/// own project identity, including for the built-in workspace it always offers.
struct MobileSummaryAgentGroup: Decodable, Identifiable, Hashable {
    let projectId: String
    let name: String
    let isDefault: Bool

    var id: String { projectId }
}

/// One Provider a conversation may be started with.
///
/// There is no endpoint here and no credential, deliberately: the computer reads its
/// own key when it launches, and the phone is never in a position to hold one.
struct MobileSummaryAgentProvider: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /// The Provider the computer itself would use if this phone named none.
    ///
    /// Not "the active one" — the desktop resolves a configured default first. This is
    /// therefore what the panel preselects, because it is what would actually happen.
    let isDefault: Bool
    /// The tier this Provider would be used at, so no row's model name is a guess.
    let defaultTier: MobileModelTier
    /// Model name by tier. A tier the Provider does not name is absent.
    let models: [String: String]

    func modelName(for tier: MobileModelTier) -> String? { models[tier.rawValue] }

    /// The tiers this Provider offers, in the desktop's own display order.
    var selectableTiers: [MobileModelTier] {
        MobileModelTier.displayOrder.filter { models[$0.rawValue] != nil }
    }
}

struct MobileSummaryPayload: Decodable {
    let desktopClientInstanceId: String
    let desktopName: String
    let revision: Int
    let groups: [MobileSummaryGroup]
    /// Tabs that hold a split, and only those.
    ///
    /// Optional on purpose: a desktop that has no splits omits the field entirely,
    /// and one that predates it never sends it. Both decode to `nil`, which is why
    /// the list falls back to its flat form without needing a branch of its own.
    let workspaces: [MobileSummaryWorkspace]?
    /// Where a Claude Code conversation may be started, and with which Provider.
    ///
    /// Optional for a different reason than `workspaces`: absent means the computer
    /// cannot say — it predates these intents. An empty array is a computer that can
    /// say and has nothing to offer. The new-conversation panel is offered for the
    /// first and unavailable for the second, so the two must not be conflated.
    let agentGroups: [MobileSummaryAgentGroup]?
    let agentProviders: [MobileSummaryAgentProvider]?
    let sessions: [MobileSummarySession]
}

/// One tab of a desktop workspace, once it holds more than one pane.
struct MobileSummaryWorkspace: Decodable, Hashable {
    let id: String
    let groupId: String
    let title: String
    let panes: [MobileSummaryWorkspacePane]
}

struct MobileSummaryWorkspacePane: Decodable, Hashable {
    let paneId: String
    let sessionId: String
}

// MARK: - Terminal frame

struct TerminalCursor: Decodable, Hashable {
    /// Absolute gateway line index, not an offset into `lines`.
    let row: Int
    let col: Int
    let visible: Bool

    static let hidden = TerminalCursor(row: 0, col: 0, visible: false)

    private enum CodingKeys: String, CodingKey { case row, col, visible }

    init(row: Int, col: Int, visible: Bool) {
        self.row = row
        self.col = col
        self.visible = visible
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        row = (try? container.decode(Int.self, forKey: .row)) ?? 0
        col = (try? container.decode(Int.self, forKey: .col)) ?? 0
        visible = (try? container.decode(Bool.self, forKey: .visible)) ?? false
    }
}

/// One run of identically styled text.
struct StyleRun: Hashable, Sendable {
    let start: Int
    let length: Int
    let foreground: Int
    let background: Int
    let flags: Int

    static let defaultColor = -1
    static let truecolorBase = 0x100_0000

    var isBold: Bool { flags & 1 != 0 }
    var isItalic: Bool { flags & 2 != 0 }
    var isUnderline: Bool { flags & 4 != 0 }
    var isDim: Bool { flags & 8 != 0 }
    var isInverse: Bool { flags & 16 != 0 }
}

/// A terminal line on the wire is `[text]` or `[text, runs]`, with runs as
/// `[start, length, fg, bg, flags]`. Compact on purpose: the great majority of
/// lines carry no styling at all and would otherwise pay for empty structures.
struct TerminalLine: Decodable {
    let text: String
    let runs: [StyleRun]
    let wrapFlags: Int
    var wrappedFromPrevious: Bool { wrapFlags & 1 != 0 }
    var wrappedToNext: Bool { wrapFlags & 2 != 0 }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        text = (try? container.decode(String.self)) ?? ""
        if container.isAtEnd {
            runs = []
            wrapFlags = 0
            return
        }
        let rawRuns = (try? container.decode([[Int]].self)) ?? []
        runs = rawRuns.compactMap { values in
            guard values.count >= 5 else { return nil }
            return StyleRun(
                start: values[0],
                length: values[1],
                foreground: values[2],
                background: values[3],
                flags: values[4]
            )
        }
        wrapFlags = (try? container.decode(Int.self)) ?? 0
    }
}

struct MobileTerminalFrame: Decodable {
    let sessionId: String
    /// `suffix` replaces everything from `from` onward; `reset` also discards
    /// what came before.
    let kind: String
    let from: Int
    let lines: [TerminalLine]
    /// 这次更新立起来的最远行：`total` 及以后的内容都不存在了。
    ///
    /// 一次更新装不下一帧时会被切成好几条，而**每一条带的都是同一个 `total`** ——
    /// 它就是"这次更新的结尾"，不是"这一块的结尾"。作废要用它，不能用
    /// `from + lines.count`，否则第一块会把后面几块马上要补上来的行全删掉。
    let total: Int
    let cursor: TerminalCursor
    let alt: Bool
    let truncated: Bool
    let seq: Int
    let sizeRevision: Int

    var isReset: Bool { kind == "reset" }
    /// Replaces exactly `[from, from + lines.count)` and leaves the rest of the
    /// buffer alone, so older lines can be filled in without losing newer ones.
    var isHistory: Bool { kind == "history" }
}

struct MobileFramePayload: Decodable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let frame: MobileTerminalFrame
}

// MARK: - Intent

enum MobileKey: String, Codable, CaseIterable {
    case enter = "Enter"
    case tab = "Tab"
    case escape = "Escape"
    case arrowUp = "ArrowUp"
    case arrowDown = "ArrowDown"
    case arrowLeft = "ArrowLeft"
    case arrowRight = "ArrowRight"
    case backspace = "Backspace"
    case controlC = "Ctrl+C"
    case controlD = "Ctrl+D"
    case home = "Home"
    case end = "End"
    case pageUp = "PageUp"
    case pageDown = "PageDown"
    case delete = "Delete"
    case controlA = "Ctrl+A"
    case controlE = "Ctrl+E"
    case controlU = "Ctrl+U"
    case controlK = "Ctrl+K"
    case controlW = "Ctrl+W"
    case controlL = "Ctrl+L"
    case controlR = "Ctrl+R"
    case controlZ = "Ctrl+Z"
    // The full-keyboard page's additions. `Ctrl+I` and `Ctrl+M` are deliberately
    // absent: their bytes are Tab's and Return's, which already have names, and a
    // second name for one byte would break the computer's reverse lookup. A panel
    // that wants those chords sends the key that owns the byte.
    case controlB = "Ctrl+B"
    case controlF = "Ctrl+F"
    case controlG = "Ctrl+G"
    case controlH = "Ctrl+H"
    case controlJ = "Ctrl+J"
    case controlN = "Ctrl+N"
    case controlO = "Ctrl+O"
    case controlP = "Ctrl+P"
    case controlQ = "Ctrl+Q"
    case controlS = "Ctrl+S"
    case controlT = "Ctrl+T"
    case controlV = "Ctrl+V"
    case controlX = "Ctrl+X"
    case controlY = "Ctrl+Y"
    /// Back-tab. Claude Code cycles its permission mode on it, and the panel keeps it
    /// as a key of its own because Shift and Tab live on different pages.
    case shiftTab = "Shift+Tab"
    /// The function keys and `Insert`. Same rule as above: the name is the identifier,
    /// so the order here is the computer's `MOBILE_KEYS` and nothing else.
    case f1 = "F1"
    case f2 = "F2"
    case f3 = "F3"
    case f4 = "F4"
    case f5 = "F5"
    case f6 = "F6"
    case f7 = "F7"
    case f8 = "F8"
    case f9 = "F9"
    case f10 = "F10"
    case f11 = "F11"
    case f12 = "F12"
    case insert = "Insert"
}

enum MobileKeyAction: Encodable, Equatable {
    case text(String)
    case key(MobileKey)

    private enum CodingKeys: String, CodingKey { case type, text, key }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let value):
            try container.encode("text", forKey: .type)
            try container.encode(value, forKey: .text)
        case .key(let value):
            try container.encode("key", forKey: .type)
            try container.encode(value.rawValue, forKey: .key)
        }
    }
}

struct MobileIntentResult: Decodable {
    let intentId: String
    let outcome: String
    let code: String?
    let message: String?
    let sessionId: String?
    let createdSessionId: String?
    /// Set for `fileUpload`: where the file ended up on the computer. The phone
    /// cannot derive it, and needs it to undo the insertion it caused.
    let landedPath: String?
    /// Set for `git`，for the two actions whose answer is data rather than a side
    /// effect. `status` 的回答**不在这里** —— 手机端的状态永远以 `mobile.gitStatus`
    /// 为准，两个来源写同一件事迟早会分叉。
    let git: MobileIntentGitResult?

    var isAccepted: Bool { outcome == "accepted" }
    var isNoOp: Bool { outcome == "no_op" }
}

/// `git` 动作的回答里那几块**数据**，其余动作的回答是一句话。
struct MobileIntentGitResult: Decodable, Equatable {
    /// `branches` 的回答：只给名字与是否当前。
    let branches: [MobileGitBranch]?
    /// `remoteBranches` 的回答：平铺 + 已按「远端名 → 分支名」排好，分组是这一侧的事。
    let remoteBranches: [MobileGitRemoteBranch]?
    /// `merge` 冲突后的结论：手机端只负责把 `summaryText` 复制走。
    let conflict: MobileGitConflict?
    /// 要用户先给个东西，值说明是哪样东西。**两个取值都不是失败**：
    /// `"dirty"` = 有未提交改动，弹三选一；`"localBranchName"` = 同名本地分支不能直接用，
    /// 推一页让用户填另一个本地名。
    let needsDecision: String?
}

/// 一条本地分支，供分支列表画一行。
struct MobileGitBranch: Decodable, Equatable, Identifiable {
    let name: String
    let current: Bool

    var id: String { name }
}

/// 一条远端分支。
///
/// 与电脑端分成两段而不是拼好的 `origin/dev`：分组要靠 `remote`，而拿一段拼字符串再拆回来
/// 是个必然会写错的一步（远端名本身可以含 `/`）。给人看的那一份由 `qualifiedName` 拼。
struct MobileGitRemoteBranch: Decodable, Equatable, Identifiable {
    let remote: String
    let name: String

    /// 与 git 自己的说法一致的一行字：`origin/dev`。列表里那一行、搜索匹配、标识符都用它。
    var qualifiedName: String { "\(remote)/\(name)" }

    var id: String { qualifiedName }
}

/// 合并冲突的结论。
///
/// 传的是**一段给人（以及别的 Agent）读的完整说明**，不是文件清单结构：手机端不解析
/// 文件列表，只把 `summaryText` 放进剪贴板。`files` 仍然在，因为要在弹窗里说「有 N 个
/// 文件冲突」，而它不该去数一段文本里的行。
struct MobileGitConflict: Decodable, Equatable, Identifiable {
    let source: String
    let target: String
    let files: [String]
    let summaryText: String

    /// 这一页要的是「哪两条分支撞上了」，那就是它的身份。
    var id: String { "\(source)→\(target)" }
}

struct MobileIntentResultPayload: Decodable {
    let mobileClientInstanceId: String
    let result: MobileIntentResult
}

/// How far along the computer is in fetching a file this phone relayed.
///
/// Keyed by the intent the phone sent rather than by a file name, because the
/// intent is what the strip is already showing the transfer under — the computer's
/// answer carries the same id, so progress and completion land on the same chip.
struct MobileTransferProgressPayload: Decodable {
    let mobileClientInstanceId: String
    let intentId: String
    let completedBytes: Double
    /// Zero when the download declared no length, which is a different statement
    /// from a total of zero bytes.
    let totalBytes: Double
}

// MARK: - Toolbar

/// What pressing a mirrored button makes the computer do.
///
/// Two arms because the computer has two different ways of running something and
/// they are not interchangeable: `command` writes the text and then a carriage
/// return, which is the desktop's own click, while a bare `text` action writes
/// exactly what it is given. Sending the second as the first would press Enter on
/// the user's behalf.
enum MobileToolbarAction: Decodable {
    case key(MobileKey)
    case text(String, pressEnter: Bool)

    private enum CodingKeys: String, CodingKey { case type, key, text, pressEnter }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "key":
            guard let key = MobileKey(rawValue: try container.decode(String.self, forKey: .key)) else {
                // A key this build does not know cannot be sent, and it also cannot be
                // drawn as something it is not — so the whole button is dropped rather
                // than shown doing nothing.
                throw DecodingError.dataCorruptedError(
                    forKey: .key, in: container, debugDescription: "unknown mobile key"
                )
            }
            self = .key(key)
        case "text":
            self = .text(
                try container.decode(String.self, forKey: .text),
                pressEnter: try container.decode(Bool.self, forKey: .pressEnter)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "unknown toolbar action"
            )
        }
    }
}

/// Where a button sits in the desktop's own toolbar.
///
/// Sent rather than derived: the desktop's rule is positional — its separator goes
/// before the first remaining slash command — which this client cannot reproduce
/// without re-deriving the computer's list, and the whole point is that the phone
/// shows the computer's list.
enum MobileToolbarGroup: String, Decodable {
    case key
    case command
    case custom
}

struct MobileToolbarButton: Decodable, Identifiable, Hashable {
    let id: String
    /// The computer's own wording, rendered verbatim.
    let label: String
    let group: MobileToolbarGroup
    let action: MobileToolbarAction

    static func == (lhs: MobileToolbarButton, rhs: MobileToolbarButton) -> Bool {
        lhs.id == rhs.id && lhs.label == rhs.label
            && lhs.group == rhs.group && lhs.action == rhs.action
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

extension MobileToolbarAction: Equatable {
    static func == (lhs: MobileToolbarAction, rhs: MobileToolbarAction) -> Bool {
        switch (lhs, rhs) {
        case (.key(let a), .key(let b)): return a == b
        case (.text(let a, let x), .text(let b, let y)): return a == b && x == y
        default: return false
        }
    }

    /// The intent pressing this button sends.
    ///
    /// Every arm maps onto an intent that already existed, which is what made this
    /// feature one more kind of data rather than a new protocol — and it is why the
    /// mapping is one function rather than three call sites: the difference between
    /// running a command and only typing it is a single flag, and getting that flag
    /// backwards presses Enter on the user's behalf.
    ///
    /// Deliberately not `command` for the typing case. `command` writes the text and
    /// then a carriage return, so it *runs* the line; `keys` with a text action writes
    /// exactly what it is given.
    func intent(sessionId: String, intentId: String) -> MobileIntentRequest {
        switch self {
        case .key(let key):
            return MobileIntentRequest(
                intentId: intentId, kind: "keys", sessionId: sessionId, actions: [.key(key)]
            )
        case .text(let text, let pressEnter):
            guard pressEnter else {
                return MobileIntentRequest(
                    intentId: intentId, kind: "keys", sessionId: sessionId, actions: [.text(text)]
                )
            }
            return MobileIntentRequest(
                intentId: intentId, kind: "command", sessionId: sessionId, text: text
            )
        }
    }

    /// Whether pressing this button submits a line, and therefore spends the chip an
    /// inserted path was holding.
    var submitsLine: Bool {
        switch self {
        case .key(let key): return key == .enter
        case .text(_, let pressEnter): return pressEnter
        }
    }
}

/// The command buttons the computer offers, which this phone shows read-only.
///
/// A full snapshot every time: the client replaces what it holds, so a lost message
/// costs nothing beyond waiting for the next one. An empty `buttons` is a real
/// answer — "this computer has none" — and is not the same as never having received
/// this message at all, which is what the fallback below stands for.
struct MobileToolbarPayload: Decodable {
    let desktopClientInstanceId: String
    let revision: Int
    let buttons: [MobileToolbarButton]

    init(desktopClientInstanceId: String, revision: Int, buttons: [MobileToolbarButton]) {
        self.desktopClientInstanceId = desktopClientInstanceId
        self.revision = revision
        self.buttons = buttons
    }

    private enum CodingKeys: String, CodingKey { case desktopClientInstanceId, revision, buttons }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Strict where the message as a whole is concerned: without an identity the list
        // cannot be filed under a computer, and filing it under the wrong one would show
        // one machine's commands while another is on screen.
        desktopClientInstanceId = try container.decode(String.self, forKey: .desktopClientInstanceId)
        revision = try container.decode(Int.self, forKey: .revision)
        // Lossy where the buttons are concerned, and that asymmetry is deliberate. A
        // button this build cannot act on — a key from a newer desktop — is one button
        // lost, and failing the whole message over it would freeze the entire bar on
        // every older phone the moment a computer gained one new key.
        buttons = try container.decode([LossyButton].self, forKey: .buttons).compactMap(\.value)
    }

    /// Decodes a button, or nothing. Used to skip an unusable one without giving up the
    /// rest of the list.
    private struct LossyButton: Decodable {
        let value: MobileToolbarButton?

        init(from decoder: Decoder) throws {
            value = try? MobileToolbarButton(from: decoder)
        }
    }
}

// MARK: - Group commands

/// 一个分组里保存的一条启动命令。
///
/// 只有 id 与 name：正文不在这条消息里 —— 桌面自己那个「以命令启动」下拉也只写名字，
/// 而正文在电脑上是加密存储的、还可以挂自己的环境变量。
struct MobileGroupCommand: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

/// 一个分组保存的启动命令，按电脑上的顺序。
struct MobileGroupCommandsEntry: Decodable, Hashable {
    let groupId: String
    let commands: [MobileGroupCommand]
}

/// 一台电脑上配了启动命令的那些分组。
///
/// 整份快照，与工具栏一样：手机用它替换自己那份，所以丢一条只等于等下一个 —— 而电脑
/// 每秒都在比一次内容，变化约一秒内就会再来一次。
///
/// 与 `MobileToolbarPayload` 不同，这里**没有**逐条容错的解码：一条记录只有两个字符串，
/// 没有「更新的电脑送来的、这个版本还不认识的那种命令」。多出来的字段会被合成解码器
/// 忽略，那正是以后加字段该有的样子。
struct MobileGroupCommandsPayload: Decodable {
    let desktopClientInstanceId: String
    let revision: Int
    let groups: [MobileGroupCommandsEntry]
}

// MARK: - Quick phrases

/// One sentence the user keeps in their computer's 快捷输入 app.
///
/// Only the two fields a row draws. The computer's own entry also carries a schema
/// version, a sort position and two timestamps, and the phone shows none of them —
/// the list arrives in the computer's order, which is what the sort position was for.
struct MobileQuickPhrase: Decodable, Identifiable, Hashable {
    let id: String
    /// The computer's own wording, rendered verbatim — it goes into the composer as a
    /// draft the user is expected to send, so nothing here may tidy it up.
    let content: String
}

/// The 快捷输入 sentences one computer holds.
///
/// A full snapshot every time: the client replaces what it holds, so a lost message
/// costs nothing beyond waiting for the next one.
struct MobileQuickPhrasesPayload: Decodable {
    let desktopClientInstanceId: String
    let revision: Int
    let phrases: [MobileQuickPhrase]

    init(desktopClientInstanceId: String, revision: Int, phrases: [MobileQuickPhrase]) {
        self.desktopClientInstanceId = desktopClientInstanceId
        self.revision = revision
        self.phrases = phrases
    }

    private enum CodingKeys: String, CodingKey { case desktopClientInstanceId, revision, phrases }

    /// Strict, unlike the toolbar's button list.
    ///
    /// The toolbar has to skip a button it cannot act on, because a newer computer may
    /// name a key this build has never heard of, and failing the message over that one
    /// button would freeze the whole bar. There is nothing here that can be newer than
    /// this build: a sentence is two strings, and one that will not decode means the
    /// message itself is malformed — the same thing a missing identity means.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        desktopClientInstanceId = try container.decode(String.self, forKey: .desktopClientInstanceId)
        revision = try container.decode(Int.self, forKey: .revision)
        phrases = try container.decode([MobileQuickPhrase].self, forKey: .phrases)
    }
}

/// One thing the user copied on their computer.
///
/// `id` is the computer's own hash of the text. This side never recomputes it and does
/// not need to: it is how a row is addressed across sends, which is what lets a
/// repeated copy move the existing row instead of adding a second one.
/// `Codable` rather than `Decodable`, unlike every other payload type on this file: the
/// phone writes these down. Its list has to survive the app being killed and the network
/// being gone, which is the whole reason it keeps its own copy instead of asking the
/// computer every time it opens the panel. The stored shape is the wire shape — three
/// strings — so there is no second type to keep in step; a build that cannot read a
/// stored entry treats the store as empty rather than failing, the way the meeting audio
/// cache does.
struct MobileClipboardEntry: Codable, Identifiable, Hashable {
    let id: String
    /// The copied text, verbatim. It is on its way to this phone's own clipboard, so
    /// nothing here may tidy it up.
    let text: String
    /// When it was copied, as the computer wrote it. Kept as the wire string with the
    /// parse on demand, the way every other timestamp on this protocol is: a computed
    /// property cannot fail a decode, and `parseWireTimestamp` is the one place that
    /// knows about the milliseconds.
    let copiedAt: String

    var copiedAtDate: Date? { ISO8601DateFormatter.parseWireTimestamp(copiedAt) }
}

/// The text one computer has copied recently, newest first.
///
/// A snapshot of the computer's in-memory ring, and deliberately not everything this
/// phone should show: twenty here against fifty kept locally. The two lists are not
/// meant to be equal, and what arrives is merged rather than assigned.
struct MobileClipboardPayload: Decodable {
    let desktopClientInstanceId: String
    let revision: Int
    let entries: [MobileClipboardEntry]

    init(desktopClientInstanceId: String, revision: Int, entries: [MobileClipboardEntry]) {
        self.desktopClientInstanceId = desktopClientInstanceId
        self.revision = revision
        self.entries = entries
    }

    private enum CodingKeys: String, CodingKey { case desktopClientInstanceId, revision, entries }

    /// Strict, like the phrases and for the same reason: an entry is three strings, so
    /// one that will not decode means the message is malformed rather than newer than
    /// this build. Lenient decoding would be worse here than anywhere else on this
    /// protocol — the phone's list outlives the message, so a half-decoded entry would
    /// sit in it across launches.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        desktopClientInstanceId = try container.decode(String.self, forKey: .desktopClientInstanceId)
        revision = try container.decode(Int.self, forKey: .revision)
        entries = try container.decode([MobileClipboardEntry].self, forKey: .entries)
    }
}

struct MobileIntentPayload: Decodable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let intent: MobileIntentEcho
}

/// Only used when a desktop-shape message arrives on the phone channel, which
/// should not happen; decoding it keeps the envelope handling uniform.
struct MobileIntentEcho: Decodable {
    let intentId: String
    let kind: String
}

// MARK: - Outbound

struct MobileIntentRequest: Encodable {
    let v = 1
    /// Mutable because a write that was rejected as preempted is replayed as a
    /// new intent: the gateway dedupes by this id and would answer the replay
    /// with the cached rejection.
    var intentId: String
    let kind: String
    var sessionId: String?
    var text: String?
    var actions: [MobileKeyAction]?
    var title: String?
    var groupId: String?
    var commandId: String?
    /// Starting a Claude Code conversation: which project, and optionally which
    /// Provider and tier.
    ///
    /// The two optional ones travel together and are omitted together. Absent means
    /// "the computer decides", which is the ordinary case — the phone's own default
    /// would be a second answer to a question the desktop already answers for its
    /// ⌘-click shortcut, and the two could disagree. See `shared/src/mobile-live.ts`.
    var projectId: String?
    var providerId: String?
    var modelTier: String?
    /// History paging: the oldest line the client holds, and how many to fetch below it.
    var before: Int?
    var limit: Int?
    /// Grid the phone wants the PTY to adopt, for the display mode where the phone
    /// drives the size. Also the starting grid on `create`, where it has to arrive
    /// with the session: a shell prints its banner and first prompt within
    /// milliseconds, laid out for whatever width the PTY had at the time, and those
    /// lines stay in scrollback at that width forever.
    var cols: Int?
    var rows: Int?
    /// Shown on the desktop badge that names the device deciding the grid.
    var deviceLabel: String?
    /// File hand-off. The bytes never travel on this socket: they are uploaded to
    /// the drive over HTTP first, and these two name what the computer should fetch
    /// and what it should call the result. See `shared/src/mobile-live.ts`.
    var driveItemId: String?
    var fileName: String?
    /// Git 操作（`kind == "git"`）。
    ///
    /// `action` 是**枚举**，不是命令字符串：手机把用户按下的那个动作名发过去，电脑按
    /// 名字分派（`shared/src/mobile-live.ts` 的 `MobileGitAction`）。这条线只认路径，
    /// 与 Synapse 的「代码仓库」那套没有产品关系。
    var action: String?
    /// `checkout` / `createBranch` / `merge` 的对象分支。
    var branch: String?
    /// `createBranch` 的起点；缺席＝从当前 HEAD 起。
    var fromBranch: String?
    /// `commit` 的提交信息。
    var message: String?
    /// `commit` 之后是否接着推送（提交页那个开关，默认关）。
    var pushAfterCommit: Bool?
    /// `merge` 的方向，见 `MobileGitMergeDirection`。
    var direction: String?
    /// `checkout` 的「丢弃改动并切换」。**不删未跟踪文件。**
    var discardChanges: Bool?
    /// `checkoutRemote` 的远端名（`origin`）。远端名本身可以含 `/`。
    var remote: String?
    /// `checkoutRemote` 的另一个本地名；缺席＝与远端分支同名。
    var localBranch: String?
}

struct MobileIntentPayloadOut: Encodable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let intent: MobileIntentRequest
}

struct HelloPayload: Encodable {
    let clientInstanceId: String
    let appVersion: String
    let platform: String
    let deviceName: String
}

struct PingPayload: Encodable {
    let sentAt: String
}

struct OutboundEnvelope<Payload: Encodable>: Encodable {
    let type: String
    let id: String
    let sentAt: String
    let payload: Payload

    static func make(_ type: String, _ payload: Payload) -> OutboundEnvelope {
        OutboundEnvelope(
            type: type,
            id: UUID().uuidString,
            // 单例那个 formatter，不要就地新建：这条路上一次按键就是一次（见 `wire`）。
            sentAt: ISO8601DateFormatter.wire.string(from: Date()),
            payload: payload
        )
    }
}

/// 出站那条路：信封 + 编码 + UTF-8，三处调用点原来是同一段代码各抄一遍。
///
/// 编码器同样复用 —— `JSONEncoder()` 不是免费的，而 ping 每 20 秒一次、按键每次都发。
/// 全部在主 actor 上用，`JSONEncoder` 本身没有可变状态。
enum LiveWire {
    private static let encoder = JSONEncoder()

    /// 一条可以直接交给 socket 的文本，编不出来时 nil（调用点各自决定要不要继续）。
    static func text<P: Encodable>(_ type: String, _ payload: P) -> String? {
        guard let data = try? encoder.encode(OutboundEnvelope.make(type, payload)) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
